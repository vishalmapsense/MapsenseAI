/**
 * Tabular Data Interceptor
 * ─────────────────────────────────────────────────────────────
 * Intercepts DuckDB query results at the agent level (via afterToolCallback),
 * extracts tabular data (columns + rows), stores it in a shared buffer,
 * and returns a lightweight text summary to the LLM — so the LLM never
 * sees raw query result data (token safety).
 *
 * Pattern mirrors: spatialDataInterceptor.ts
 * Used by: adkAgent.ts → afterToolCallback on duckdb_agent
 * Consumed by: route.ts → reads tabularDataBuffer after runner completes
 * ─────────────────────────────────────────────────────────────
 */

import type { SuggestedVisualizationLayer } from "@/types/mcp.types";
import { suggestVisualizationLayers } from "./layerSuggestionEngine";
import wkx from "wkx";

/** WKT geometry type keywords */
const WKT_TYPES = [
  "POINT", "LINESTRING", "POLYGON",
  "MULTIPOINT", "MULTILINESTRING", "MULTIPOLYGON",
  "GEOMETRYCOLLECTION",
];

/**
 * Check if a value is a raw binary geometry or GeoJSON representation that needs conversion.
 * Detects: WKB hex strings, WKT text, Buffer objects, GeoJSON objects/strings.
 */
function isRawGeometry(val: unknown): boolean {
  if (val instanceof Buffer || val instanceof Uint8Array) return true;
  if (typeof val === "object" && val !== null && (val as any).type && ((val as any).coordinates || (val as any).geometries)) return true;
  if (typeof val !== "string") return false;
  let trimmed = val.trim();
  if (trimmed.length === 0) return false;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") trimmed = parsed.trim();
    } catch {}
  }
  // WKB with \x escape prefix (DuckDB common format)
  if (trimmed.startsWith("\\x")) return true;
  // Raw WKB hex: starts with 00 or 01, only hex chars, at least 10 chars
  if (/^(00|01)[0-9a-fA-F]{8,}$/.test(trimmed)) return true;
  // WKT: starts with a geometry type keyword
  const upper = trimmed.toUpperCase();
  if (WKT_TYPES.some(t => upper.startsWith(t + " ") || upper.startsWith(t + "("))) return true;
  // GeoJSON string: starts with { and contains "coordinates" or "geometries" or "type"
  if (trimmed.startsWith("{") && (trimmed.includes('"coordinates"') || trimmed.includes('"geometries"') || trimmed.includes('"type"'))) return true;
  return false;
}

/**
 * Convert a raw geometry value (WKB hex, WKT text, Buffer, or GeoJSON string/object) to a GeoJSON geometry object.
 * Returns null if parsing fails.
 */
function convertToGeoJSON(val: unknown): any | null {
  try {
    if (!val) return null;
    // Case 0: Already a GeoJSON geometry object
    if (typeof val === "object" && val !== null && !Buffer.isBuffer(val) && !(val instanceof Uint8Array)) {
      if ((val as any).type && ((val as any).coordinates || (val as any).geometries)) {
        return val;
      }
    }

    // Case 1: Buffer / Uint8Array (direct binary)
    if (val instanceof Buffer) {
      return wkx.Geometry.parse(val).toGeoJSON();
    }
    if (val instanceof Uint8Array) {
      return wkx.Geometry.parse(Buffer.from(val)).toGeoJSON();
    }

    if (typeof val !== "string") return null;
    let trimmed = val.trim();

    // Handle quoted JSON strings (e.g. from CSV or nested JSON)
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      try {
        const unquoted = JSON.parse(trimmed);
        if (typeof unquoted === "object" && unquoted !== null) return unquoted;
        if (typeof unquoted === "string") trimmed = unquoted.trim();
      } catch {}
    }

    // Case 2: Direct GeoJSON JSON string
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && (parsed.type || parsed.coordinates)) {
          return parsed;
        }
      } catch {}
    }

    // Case 3: WKT string (POLYGON(...), POINT(...), etc.)
    const upper = trimmed.toUpperCase();
    if (WKT_TYPES.some(t => upper.startsWith(t + " ") || upper.startsWith(t + "("))) {
      return wkx.Geometry.parse(trimmed).toGeoJSON();
    }

    // Case 4: WKB hex with \x escape (DuckDB format: \x01\x03\x00...)
    if (trimmed.startsWith("\\x")) {
      const hex = trimmed.replace(/\\x/g, "");
      const buf = Buffer.from(hex, "hex");
      return wkx.Geometry.parse(buf).toGeoJSON();
    }

    // Case 5: Raw WKB hex (0103000000...)
    if (/^(00|01)[0-9a-fA-F]{8,}$/.test(trimmed)) {
      const buf = Buffer.from(trimmed, "hex");
      return wkx.Geometry.parse(buf).toGeoJSON();
    }

    return null;
  } catch {
    return null;
  }
}

/** Number of sample rows to include in the LLM summary text. */
const SAMPLE_ROWS_FOR_SUMMARY = 3;

/** A single tabular query result intercepted from a tool response. */
export interface TabularResultData {
  queryId: string;
  queryText: string;
  columns: string[];
  rows: any[][];
  rowCount: number;
  totalRowCount: number; // original count before truncation
  truncated: boolean;
  executionTimeMs?: number;
  toolName: string;
  timestamp: number;
  hasSpatialColumn: boolean;
  spatialColumnName?: string;
  /** AI-recommended visualization layers for this query result */
  suggestedLayers?: SuggestedVisualizationLayer[];
}

/**
 * Shared buffer — created per-request by the route, passed into createADKAgent,
 * and populated by afterToolCallback. After runner.runAsync() completes,
 * the route reads this buffer to send queryResults to the client.
 */
export type TabularDataBuffer = TabularResultData[];

/**
 * Known column names that indicate spatial/geometry data.
 */
const SPATIAL_COLUMN_NAMES = [
  "geom",
  "geometry",
  "wkb_geometry",
  "the_geom",
  "shape",
  "geo",
  "wkt",
];

/**
 * Generates a short text summary for the LLM from extracted tabular data.
 * Replaces the full result payload so the LLM only sees metadata + samples.
 */
export function createTabularSummary(result: TabularResultData): string {
  const { columns, rows, rowCount, totalRowCount, truncated, queryText } =
    result;

  const queryUpper = (queryText || "").toUpperCase();
  const colNamesLower = columns.map(c => c.toLowerCase());

  // Check if this is a schema inspection query:
  // e.g. DESCRIBE, PRAGMA table_info, SHOW TABLES, or returning (column_name, column_type) or (name, type)
  const isSchemaQuery =
    queryUpper.includes("DESCRIBE") ||
    queryUpper.includes("PRAGMA TABLE_INFO") ||
    queryUpper.includes("PRAGMA") ||
    queryUpper.includes("INFORMATION_SCHEMA") ||
    queryUpper.includes("SHOW TABLES") ||
    (colNamesLower.includes("column_name") && colNamesLower.includes("column_type")) ||
    (colNamesLower.includes("cid") && colNamesLower.includes("name") && colNamesLower.includes("type"));

  // Check if this is a query selecting column names e.g. SELECT column_name FROM (DESCRIBE ...)
  const isColumnNamesOnlyQuery =
    columns.length === 1 && (colNamesLower[0] === "column_name" || colNamesLower[0] === "name");

  if (isSchemaQuery && !isColumnNamesOnlyQuery) {
    const colNameIdx = colNamesLower.indexOf("column_name") !== -1
      ? colNamesLower.indexOf("column_name")
      : colNamesLower.indexOf("name");
    const colTypeIdx = colNamesLower.indexOf("column_type") !== -1
      ? colNamesLower.indexOf("column_type")
      : colNamesLower.indexOf("type");

    let schemaSummary = `📋 Dataset Schema (${rows.length} columns detected):\n`;
    schemaSummary += `Query: ${queryText.length > 120 ? queryText.substring(0, 120) + "..." : queryText}\n\n`;

    if (colNameIdx !== -1) {
      rows.forEach((r, idx) => {
        const cName = r[colNameIdx];
        const cType = colTypeIdx !== -1 ? r[colTypeIdx] : "";
        schemaSummary += `  ${idx + 1}. "${cName}"${cType ? ` (${cType})` : ""}\n`;
      });
    } else {
      rows.forEach((r, idx) => {
        const entry = columns.map((col, j) => `${col}=${JSON.stringify(r[j])}`).join(", ");
        schemaSummary += `  ${idx + 1}. {${entry}}\n`;
      });
    }

    schemaSummary += `\n💡 TIP: Use exact column names as shown above. If a column has uppercase letters, ALWAYS double-quote it (e.g., "Population").`;
    return schemaSummary;
  }

  if (isColumnNamesOnlyQuery) {
    const colNames = rows.map((r) => r[0]).filter(Boolean);
    let colSummary = `📋 Dataset Columns (${colNames.length} total):\n`;
    colSummary += colNames.map((c, i) => `  ${i + 1}. "${c}"`).join("\n");
    colSummary += `\n\n💡 TIP: Double-quote columns with uppercase letters (e.g., "Population").`;
    return colSummary;
  }

  // ── Standard Data Query Summary ──
  // Show up to 50 columns without truncating to 10
  const maxColsToList = 50;
  const colList = columns.slice(0, maxColsToList).map(c => `"${c}"`).join(", ");
  const colSuffix = columns.length > maxColsToList ? ` (+${columns.length - maxColsToList} more)` : "";

  let summary =
    `✅ DuckDB query executed successfully.\n` +
    `Query: ${queryText.length > 120 ? queryText.substring(0, 120) + "..." : queryText}\n` +
    `Result: ${totalRowCount} row${totalRowCount !== 1 ? "s" : ""}, ${columns.length} column${columns.length !== 1 ? "s" : ""}.\n` +
    `Columns (${columns.length}): [${colList}${colSuffix}]\n`;

  if (truncated) {
    summary += `⚠️ Result truncated to ${rowCount} rows for display (original: ${totalRowCount}).\n`;
  }

  // Add sample rows for context: format geometry columns as "<Geometry>" or "<Polygon>" to save tokens,
  // truncate long string values, and show up to 15 key columns.
  const sampleCount = Math.min(SAMPLE_ROWS_FOR_SUMMARY, rows.length);
  if (sampleCount > 0) {
    summary += `\nSample rows (first ${sampleCount}):\n`;
    for (let i = 0; i < sampleCount; i++) {
      const row = rows[i];
      const maxSampleCols = Math.min(15, columns.length);
      const pairs: string[] = [];

      for (let j = 0; j < maxSampleCols; j++) {
        const col = columns[j];
        const val = row[j];
        const isNonGeomMetric = ["shape_area", "shape_leng", "shape_length", "shape_len"].includes(col.toLowerCase());
        const isLikelyGeom =
          !isNonGeomMetric &&
          ((result.hasSpatialColumn && col === result.spatialColumnName) ||
            isRawGeometry(val) ||
            (val && typeof val === "object" && (val as any).type) ||
            (typeof val === "string" && val.startsWith("{") && val.includes('"coordinates"')));

        if (isLikelyGeom) {
          let geomType = "Geometry";
          if (val && typeof val === "object" && (val as any).type) {
            geomType = (val as any).type;
          } else if (typeof val === "string") {
            const m = val.match(/"type"\s*:\s*"(\w+)"/i);
            if (m) geomType = m[1];
          }
          pairs.push(`"${col}": "<${geomType}>"`);
        } else if (typeof val === "string" && val.length > 50) {
          pairs.push(`"${col}": ${JSON.stringify(val.substring(0, 47) + "...")}`);
        } else {
          pairs.push(`"${col}": ${JSON.stringify(val)}`);
        }
      }

      summary += `  Row ${i + 1}: {${pairs.join(", ")}${columns.length > maxSampleCols ? ", ..." : ""}}\n`;
    }
  }

  summary +=
    `\nThe full result data has been sent directly to the client for display in the Query Results Panel. ` +
    (result.hasSpatialColumn
      ? `Spatial boundaries/geometries have been sent to the map for automatic rendering. `
      : ``) +
    `Do NOT try to reproduce all raw rows in your response. Provide the key analytical insight to the user.`;

  return summary;
}

/**
 * Attempts to parse a DuckDB query result from the MCP tool response
 * and extract columns + rows in a normalized tabular format.
 *
 * Returns TabularResultData if successful, null otherwise.
 */
export async function extractTabularFromResponse(
  toolName: string,
  rawResponse: any,
  queryText?: string,
): Promise<TabularResultData | null> {
  if (!rawResponse || typeof rawResponse !== "object") return null;

  let data: any = null;

  // ── Case 1: MCP content blocks array ──
  if (Array.isArray(rawResponse.content)) {
    for (const block of rawResponse.content) {
      if (block.type === "text" && typeof block.text === "string") {
        const trimmed = block.text.trim();

        // Skip spatial intercept markers
        if (trimmed.startsWith("✅") && trimmed.includes("features extracted")) {
          return null;
        }

        // Try parsing as JSON first
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            data = JSON.parse(trimmed);
            break;
          } catch {
            // Not JSON, continue checking for URL
          }
        }

        // Check for Response_URL
        if (!data) {
          const urlMatch = trimmed.match(/Response_URL:\s*(https?:\/\/[^\s"']+)/i);
          if (urlMatch && urlMatch[1]) {
            try {
              console.log(`  ↳ [Tabular Interceptor] Fetching Response_URL: ${urlMatch[1]}`);
              const res = await fetch(urlMatch[1]);
              if (res.ok) {
                data = await res.json();
                if (typeof data === "string") {
                  try {
                    data = JSON.parse(data);
                  } catch (e) {
                    console.error("  ↳ [Tabular Interceptor] Failed to double-parse JSON string from Response_URL");
                  }
                }
                break;
              } else {
                console.error(`  ↳ [Tabular Interceptor] HTTP error fetching Response_URL: ${res.status}`);
              }
            } catch (err) {
              console.error(`  ↳ [Tabular Interceptor] Failed to fetch Response_URL:`, err);
            }
          }
        }
      }
    }
  }

  // ── Case 2: structuredContent ──
  if (!data && rawResponse.structuredContent) {
    data = rawResponse.structuredContent;
  }

  // ── Case 3: Direct object with rows-like structure ──
  if (!data && (Array.isArray(rawResponse) || rawResponse.rows || rawResponse.data || rawResponse.result)) {
    data = rawResponse;
  }

  if (!data) return null;

  // ── Universal Normalization to { columns, rows } ──
  let columns: string[] = [];
  let rows: any[][] = [];

  // 1. Format: GeoJSON FeatureCollection
  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    const propSet = new Set<string>();
    data.features.forEach((f: any) => {
      if (f.properties) Object.keys(f.properties).forEach(k => propSet.add(k));
    });
    columns = ["geom", ...Array.from(propSet)];
    rows = data.features.map((f: any) => {
      const row = [f.geometry];
      for (let i = 1; i < columns.length; i++) {
        row.push(f.properties ? f.properties[columns[i]] : null);
      }
      return row;
    });
  } 
  // 2. Format: Explicit { columns: [], rows/data: [][] }
  else if (data.columns && Array.isArray(data.columns) && (Array.isArray(data.rows) || Array.isArray(data.data))) {
    columns = data.columns;
    rows = data.rows || data.data || [];
  } 
  // 3. Fallback: Search for any array or treat as single object
  else {
    // Determine the main array to process
    let targetArray: any[] | null = null;
    if (Array.isArray(data)) {
      targetArray = data;
    } else if (typeof data === "object" && data !== null) {
      if (Array.isArray(data.result)) targetArray = data.result;
      else if (Array.isArray(data.data)) targetArray = data.data;
      else if (Array.isArray(data.rows)) targetArray = data.rows;
      else {
        // Deep search for any array (up to depth 3)
        const findArr = (obj: any, depth = 0): any[] | null => {
          if (depth > 3 || !obj || typeof obj !== 'object') return null;
          for (const val of Object.values(obj)) {
            if (Array.isArray(val) && val.length > 0) return val;
            if (typeof val === 'object' && val !== null) {
              const res = findArr(val, depth + 1);
              if (res) return res;
            }
          }
          return null;
        };
        targetArray = findArr(data);
      }
    }

    if (targetArray && targetArray.length > 0) {
      const first = targetArray[0];
      if (typeof first === "object" && first !== null && !Array.isArray(first)) {
        // Array of objects (Standard tabular)
        const keySet = new Set<string>();
        targetArray.forEach(obj => {
          if (typeof obj === 'object' && obj !== null) {
            Object.keys(obj).forEach(k => keySet.add(k));
          }
        });
        columns = Array.from(keySet);
        rows = targetArray.map(obj => columns.map(col => obj && typeof obj === 'object' ? obj[col] : null));
      } else if (Array.isArray(first)) {
        // Array of arrays
        columns = first.map((_, i) => `col_${i}`);
        rows = targetArray;
      } else {
        // Array of primitives
        columns = ["value"];
        rows = targetArray.map(v => [v]);
      }
    } else if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      // 4. Format: Single Object Result (e.g. COUNT query returning just { count: 5 })
      const keys = Object.keys(data);
      const looksLikeRow = keys.every(k => typeof data[k] !== "object" || data[k] === null);
      if (looksLikeRow && !data.content && !data.type && keys.length > 0) {
        columns = keys;
        rows = [keys.map(k => data[k])];
      }
    }
  }

  if (columns.length === 0) return null;

  // Detect spatial columns (handle aliases like geom-1)
  const candidateCols = columns.filter((col) => {
    const lowerCol = col.toLowerCase();
    if (["shape_area", "shape_leng", "shape_length", "shape_len"].includes(lowerCol)) return false;
    return (
      SPATIAL_COLUMN_NAMES.some((name) => lowerCol === name || lowerCol.startsWith(name + "_") || lowerCol.startsWith(name + ":") || lowerCol.startsWith(name + "-") || lowerCol.endsWith("_" + name)) ||
      lowerCol.includes("geojson")
    );
  });

  let spatialCol: string | undefined;
  if (candidateCols.length === 1) {
    spatialCol = candidateCols[0];
  } else if (candidateCols.length > 1) {
    // Multiple candidates (e.g., geom and geom:1 because LLM forgot EXCLUDE).
    // Pick the one that actually contains GeoJSON, WKB, or WKT by inspecting the first row.
    spatialCol = candidateCols.find(col => {
      const idx = columns.indexOf(col);
      if (rows.length > 0) {
        const val = rows[0][idx];
        if (typeof val === 'object' && val !== null) return true;
        if (isRawGeometry(val)) return true;
        if (typeof val === 'string') {
          let cleaned = val.trim();
          if (cleaned.startsWith('"{"\'')) cleaned = cleaned.substring(1, cleaned.length - 1).replace(/""/g, '"');
          if (cleaned.startsWith('{')) return true;
        }
      }
      return false;
    });
    // Fallback to the last candidate if none look like JSON, WKB, or WKT
    if (!spatialCol) spatialCol = candidateCols[candidateCols.length - 1];
  }

  // If no spatial column found by name, scan all columns for raw geometry values (WKB/WKT)
  if (!spatialCol && rows.length > 0) {
    for (let ci = 0; ci < columns.length; ci++) {
      if (isRawGeometry(rows[0][ci])) {
        spatialCol = columns[ci];
        console.log(`  🔍 [Tabular Interceptor] Auto-detected raw geometry column: ${spatialCol}`);
        break;
      }
    }
  }

  // Convert raw geometry values (WKB/WKT/Buffer) to GeoJSON objects in the spatial column
  if (spatialCol) {
    const spatialIdx = columns.indexOf(spatialCol);
    if (spatialIdx >= 0) {
      let converted = 0;
      rows.forEach((row) => {
        const val = row[spatialIdx];
        if (isRawGeometry(val)) {
          const geojson = convertToGeoJSON(val);
          if (geojson) {
            row[spatialIdx] = geojson;
            converted++;
          }
        }
      });
      if (converted > 0) {
        console.log(`  🔄 [Tabular Interceptor] Converted ${converted}/${rows.length} raw geometries to GeoJSON in column '${spatialCol}'`);
      }
    }
  }

  const totalRowCount = rows.length;
  const truncated = false;
  const cappedRows = rows;

  const result: TabularResultData = {
    queryId: `duckdb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    queryText: queryText || "(query text not captured)",
    columns,
    rows: cappedRows,
    rowCount: cappedRows.length,
    totalRowCount,
    truncated,
    toolName,
    timestamp: Date.now(),
    hasSpatialColumn: !!spatialCol,
    spatialColumnName: spatialCol || undefined,
  };

  // Compute AI-recommended visualization layers
  const suggestedLayers = suggestVisualizationLayers(result);
  if (suggestedLayers.length > 0) {
    result.suggestedLayers = suggestedLayers;
    console.log(
      `  🎨 [Tabular Interceptor] Suggested ${suggestedLayers.length} visualization layers: ` +
      suggestedLayers.map(l => `${l.type}${l.isPrimary ? ' (primary)' : ''}`).join(', ')
    );
  }

  return result;
}
