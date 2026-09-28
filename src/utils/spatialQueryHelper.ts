import wkx from "wkx";
import type { QueryResultData, SuggestedVisualizationLayer } from "@/types/mcp.types";
import { suggestVisualizationLayers } from "@/agents/utils/layerSuggestionEngine";

/**
 * Attempts to parse any geometry value into a valid GeoJSON Geometry object.
 * Supports:
 * - GeoJSON geometry object
 * - GeoJSON feature object
 * - JSON strings (including escaped JSON)
 * - Coordinate arrays: [lng, lat]
 * - WKT strings: POINT, POLYGON, LINESTRING, MULTIPOINT, etc.
 * - WKB buffers or hex strings
 */
export function parseGeometryValue(val: any): any | null {
  if (val === null || val === undefined) return null;

  // 1. Direct object
  if (typeof val === "object") {
    if (val.type && (val.coordinates || val.geometries)) return val;
    if (val.geometry?.type && (val.geometry.coordinates || val.geometry.geometries)) return val.geometry;
    if (val instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(val))) {
      try {
        return wkx.Geometry.parse(Buffer.from(val)).toGeoJSON();
      } catch {
        return null;
      }
    }
    return null;
  }

  // 2. String representation
  if (typeof val === "string") {
    let str = val.trim();
    if (!str) return null;

    // Strip wrapping quotes if any (e.g. '"{"type":...}"' or "'{...}'")
    if (
      (str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))
    ) {
      str = str.slice(1, -1).trim();
    }
    // Unescape double quotes from CSV/SQL
    if (str.includes('""')) {
      str = str.replace(/""/g, '"');
    }

    // JSON parse attempt
    if (str.startsWith("{") || str.startsWith("[")) {
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed) && parsed.length >= 2 && typeof parsed[0] === "number" && typeof parsed[1] === "number") {
          return { type: "Point", coordinates: [parsed[0], parsed[1]] };
        }
        if (parsed.type && (parsed.coordinates || parsed.geometries)) return parsed;
        if (parsed.geometry?.type) return parsed.geometry;
      } catch {
        // Fall through to WKT / Hex check
      }
    }

    // WKT parse attempt (e.g. POINT(x y), POLYGON(...))
    const upper = str.toUpperCase();
    if (
      upper.startsWith("POINT") ||
      upper.startsWith("LINESTRING") ||
      upper.startsWith("POLYGON") ||
      upper.startsWith("MULTIPOINT") ||
      upper.startsWith("MULTILINESTRING") ||
      upper.startsWith("MULTIPOLYGON") ||
      upper.startsWith("GEOMETRYCOLLECTION")
    ) {
      try {
        return wkx.Geometry.parse(str).toGeoJSON();
      } catch {
        // Regex fallback for simple POINT(lng lat)
        const ptMatch = str.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
        if (ptMatch) {
          const x = parseFloat(ptMatch[1]);
          const y = parseFloat(ptMatch[2]);
          if (!isNaN(x) && !isNaN(y)) {
            return { type: "Point", coordinates: [x, y] };
          }
        }
      }
    }

    // Hex string (WKB) attempt (e.g. 0101000000...)
    if (/^[0-9a-fA-F]{16,}$/.test(str)) {
      try {
        return wkx.Geometry.parse(Buffer.from(str, "hex")).toGeoJSON();
      } catch {
        // Not WKB
      }
    }
  }

  return null;
}

/**
 * Finds column indices representing coordinate pairs (lng & lat) in query results.
 */
export function findCoordinateColumnIndices(columns: string[]): { lngIdx: number; latIdx: number } | null {
  const lowerCols = columns.map((c) => c.toLowerCase());

  // Priority 1: centroid / precomputed center columns
  const centerLngIdx = lowerCols.indexOf("center_lng");
  const centerLatIdx = lowerCols.indexOf("center_lat");
  if (centerLngIdx !== -1 && centerLatIdx !== -1) {
    return { lngIdx: centerLngIdx, latIdx: centerLatIdx };
  }

  // Priority 2: lng & lat (or lon & lat, longitude & latitude)
  const lngIdx = lowerCols.findIndex(
    (c) =>
      c === "lng" ||
      c === "longitude" ||
      c === "lon" ||
      c.endsWith("_lng") ||
      c.endsWith("_longitude") ||
      c.endsWith("_lon")
  );
  const latIdx = lowerCols.findIndex(
    (c) =>
      c === "lat" ||
      c === "latitude" ||
      c.endsWith("_lat") ||
      c.endsWith("_latitude")
  );
  if (lngIdx !== -1 && latIdx !== -1) {
    return { lngIdx, latIdx };
  }

  // Priority 3: x & y
  const xIdx = lowerCols.indexOf("x");
  const yIdx = lowerCols.indexOf("y");
  if (xIdx !== -1 && yIdx !== -1) {
    return { lngIdx: xIdx, latIdx: yIdx };
  }

  return null;
}

/**
 * Finds the index of a geometry or spatial column in query results.
 */
export function findSpatialColumnIndex(columns: string[], rows?: any[][]): number {
  const lowerCols = columns.map((c) => c.toLowerCase());

  // 1. Check known geometry column names
  const spatialColNames = [
    "geometry",
    "geom",
    "the_geom",
    "geojson",
    "centroid",
    "st_centroid",
    "st_asgeojson",
    "wkb_geometry",
    "shape",
    "geom_json",
    "location",
    "position",
    "point",
  ];
  for (const name of spatialColNames) {
    const idx = lowerCols.indexOf(name);
    if (idx !== -1) return idx;
  }

  // 2. Check prefix / suffix
  const patternIdx = lowerCols.findIndex(
    (c) =>
      c.startsWith("st_") ||
      c.endsWith("_geom") ||
      c.endsWith("_geometry") ||
      c.endsWith("_geojson")
  );
  if (patternIdx !== -1) return patternIdx;

  // 3. Inspect first 5 rows to see if any column values parse as geometry
  if (rows && rows.length > 0) {
    for (let c = 0; c < columns.length; c++) {
      for (let r = 0; r < Math.min(5, rows.length); r++) {
        if (parseGeometryValue(rows[r][c])) {
          return c;
        }
      }
    }
  }

  return -1;
}

/**
 * Checks whether a query result contains spatial information (coordinates or geometry)
 * and can be viewed or added to the map.
 */
export function isSpatialQueryResult(data: QueryResultData): boolean {
  if (data.hasSpatialColumn) return true;
  if (data.spatialColumnName) return true;
  if (data.suggestedLayers && data.suggestedLayers.length > 0) return true;
  if (findCoordinateColumnIndices(data.columns) !== null) return true;
  if (findSpatialColumnIndex(data.columns, data.rows) !== -1) return true;
  return false;
}

/**
 * Converts a QueryResultData into an array of GeoJSON Feature objects.
 */
export function convertQueryResultToFeatures(data: QueryResultData): any[] {
  const features: any[] = [];
  const coordCols = findCoordinateColumnIndices(data.columns);
  const spatialColIdx = data.spatialColumnName
    ? data.columns.indexOf(data.spatialColumnName)
    : findSpatialColumnIndex(data.columns, data.rows);

  data.rows.forEach((row, rowIdx) => {
    let geom: any = null;

    // 1. Try geometry column
    if (spatialColIdx !== -1 && row[spatialColIdx] !== undefined) {
      geom = parseGeometryValue(row[spatialColIdx]);
    }

    // 2. Try coordinate columns
    if (!geom && coordCols) {
      const rawLng = row[coordCols.lngIdx];
      const rawLat = row[coordCols.latIdx];
      const lng = typeof rawLng === "number" ? rawLng : parseFloat(String(rawLng));
      const lat = typeof rawLat === "number" ? rawLat : parseFloat(String(rawLat));
      if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
        geom = { type: "Point", coordinates: [lng, lat] };
      }
    }

    if (geom) {
      const properties: any = {
        featureId: `${data.queryId}_${rowIdx}`,
      };
      data.columns.forEach((col, idx) => {
        if (idx !== spatialColIdx) {
          properties[col] = row[idx];
        }
      });

      features.push({
        type: "Feature",
        geometry: geom,
        properties,
      });
    }
  });

  return features;
}

/**
 * Enriches a QueryResultData object with accurate spatial metadata and suggested visualization layers.
 * Guarantees that query results loaded from Supabase or memory have their spatial flags restored.
 */
export function enrichQueryResultWithSpatial(data: QueryResultData): QueryResultData {
  const coordCols = findCoordinateColumnIndices(data.columns);
  const spatialColIdx = findSpatialColumnIndex(data.columns, data.rows);

  const hasSpatial =
    data.hasSpatialColumn ||
    coordCols !== null ||
    spatialColIdx !== -1;

  let spatialColName = data.spatialColumnName;
  if (!spatialColName && spatialColIdx !== -1) {
    spatialColName = data.columns[spatialColIdx];
  }

  let suggestedLayers = data.suggestedLayers;
  if (!suggestedLayers || suggestedLayers.length === 0) {
    const dummyTabularData = {
      queryId: data.queryId,
      queryText: data.queryText,
      columns: data.columns,
      rows: data.rows,
      rowCount: data.rowCount,
      totalRowCount: data.totalRowCount,
      truncated: data.truncated,
      executionTimeMs: data.executionTimeMs,
      toolName: data.toolName,
      timestamp: data.timestamp,
      hasSpatialColumn: hasSpatial,
      spatialColumnName: spatialColName,
    };
    try {
      const generated = suggestVisualizationLayers(dummyTabularData as any);
      if (generated && generated.length > 0) {
        suggestedLayers = generated;
      }
    } catch {
      // ignore suggestion failure
    }
  }

  return {
    ...data,
    hasSpatialColumn: hasSpatial,
    spatialColumnName: spatialColName,
    suggestedLayers,
  };
}
