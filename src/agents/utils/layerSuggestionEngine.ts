/**
 * Layer Suggestion Engine
 * ─────────────────────────────────────────────────────────────
 * Deterministic heuristic that analyzes DuckDB query results and
 * recommends the best deck.gl visualization layers. No LLM call
 * needed — pure data analysis on columns, row count, and geometry.
 *
 * Called by: tabularDataInterceptor.ts (after extracting tabular data)
 * ─────────────────────────────────────────────────────────────
 */

import type {
  SuggestedVisualizationLayer,
  VisualizationLayerType,
} from "@/types/mcp.types";
import type { TabularResultData } from "./tabularDataInterceptor";

/** Column name patterns that indicate origin/destination (OD) data */
const ORIGIN_PATTERNS = [
  "pickup_longitude", "pickup_latitude", "pickup_lng", "pickup_lat",
  "start_lng", "start_lat", "start_longitude", "start_latitude",
  "origin_lng", "origin_lat", "origin_longitude", "origin_latitude",
  "from_lng", "from_lat", "from_longitude", "from_latitude",
  "src_lng", "src_lat",
];

const DEST_PATTERNS = [
  "dropoff_longitude", "dropoff_latitude", "dropoff_lng", "dropoff_lat",
  "end_lng", "end_lat", "end_longitude", "end_latitude",
  "dest_lng", "dest_lat", "dest_longitude", "dest_latitude",
  "to_lng", "to_lat", "to_longitude", "to_latitude",
  "dst_lng", "dst_lat",
];

/** Column name patterns that indicate weight/value for aggregation */
const WEIGHT_PATTERNS = [
  "count", "total", "sum", "amount", "fare", "price", "cost",
  "population", "density", "value", "weight", "rides", "trips",
  "passengers", "revenue", "volume",
];

/**
 * Detects geometry type from a spatial column value.
 * Returns the GeoJSON geometry type string or null.
 */
function detectGeometryType(
  rows: any[][],
  columns: string[],
  spatialColumnName?: string,
): string | null {
  if (!spatialColumnName) return null;

  const colIndex = columns.indexOf(spatialColumnName);
  if (colIndex === -1) return null;

  // Check first 5 rows for geometry type
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const val = rows[i][colIndex];
    if (!val) continue;

    let geom: any = null;
    if (typeof val === "object" && val !== null) {
      geom = val;
    } else if (typeof val === "string") {
      let cleaned = val.trim();
      if (cleaned.startsWith('"{""')) {
        cleaned = cleaned.substring(1, cleaned.length - 1).replace(/""/g, '"');
      }
      if (cleaned.startsWith("{")) {
        try {
          geom = JSON.parse(cleaned);
        } catch {
          continue;
        }
      }
    }

    if (geom?.type) return geom.type;
  }
  return null;
}

/**
 * Checks if the query result has origin-destination column pairs.
 */
function hasOriginDestinationColumns(columns: string[]): boolean {
  const lowerCols = columns.map((c) => c.toLowerCase());
  const hasOrigin = ORIGIN_PATTERNS.some((p) => lowerCols.includes(p));
  const hasDest = DEST_PATTERNS.some((p) => lowerCols.includes(p));
  return hasOrigin && hasDest;
}

/**
 * Checks if the query result has flat coordinate columns (e.g., lng/lat, longitude/latitude).
 */
function hasCoordinateColumns(columns: string[]): boolean {
  const lowerCols = columns.map((c) => c.toLowerCase());
  const hasLng = lowerCols.some(c => c === 'lng' || c === 'longitude' || c === 'lon' || c.endsWith('_lng') || c.endsWith('_longitude'));
  const hasLat = lowerCols.some(c => c === 'lat' || c === 'latitude' || c.endsWith('_lat') || c.endsWith('_latitude'));
  return hasLng && hasLat;
}

/**
 * Checks if the query has weight/value columns suitable for aggregation.
 */
function hasWeightColumn(columns: string[]): boolean {
  const lowerCols = columns.map((c) => c.toLowerCase());
  return WEIGHT_PATTERNS.some((p) =>
    lowerCols.some((col) => col.includes(p)),
  );
}

function make(
  type: VisualizationLayerType,
  label: string,
  description: string,
  isPrimary: boolean,
): SuggestedVisualizationLayer {
  return { type, label, description, isPrimary };
}

/**
 * Main entry point: analyzes a TabularResultData and returns recommended
 * visualization layers ranked by suitability.
 *
 * Returns empty array if the data has no spatial column (no visualization possible).
 */
export function suggestVisualizationLayers(
  result: TabularResultData,
): SuggestedVisualizationLayer[] {
  const { totalRowCount, columns, rows, spatialColumnName } = result;
  
  const geomType = detectGeometryType(rows, columns, spatialColumnName);
  const isOD = hasOriginDestinationColumns(columns);
  const hasCoords = hasCoordinateColumns(columns);
  const hasWeight = hasWeightColumn(columns);

  // If no spatial column (GeoJSON) AND no flat coordinate pairs AND no OD pairs, we can't visualize it.
  if (!result.hasSpatialColumn && !hasCoords && !isOD) {
    return [];
  }

  const suggestions: SuggestedVisualizationLayer[] = [];

  // ─── Case 1: Origin-Destination data (taxi trips, flights, migration) ───
  if (isOD) {
    suggestions.push(
      make("ArcLayer", "Arc Map (O→D)", "Origin-destination arcs for trip/flow data", true),
    );
    if (totalRowCount > 200) {
      suggestions.push(
        make("HexagonLayer", "3D Hexagon Grid", "Aggregate pickup density into hexagonal bins", false),
      );
      suggestions.push(
        make("HeatmapLayer", "Smooth Heatmap", "Density heatmap of pickup locations", false),
      );
    }
    suggestions.push(
      make("ScatterplotLayer", "Scatter Plot", "Individual pickup/dropoff points", false),
    );
    // Also offer GeoJsonLayer as fallback if spatial column exists with geometry
    if (geomType) {
      suggestions.push(
        make("GeoJsonLayer", "Standard Map", "Render raw geometries as-is", false),
      );
    }
    return suggestions;
  }

  // ─── Case 2: LineString/MultiLineString (GPS tracks, routes) ───
  if (geomType === "LineString" || geomType === "MultiLineString") {
    suggestions.push(
      make("PathLayer", "Path / Route", "Draw connected line paths", true),
    );
    suggestions.push(
      make("GeoJsonLayer", "Standard Map", "Render line geometries as-is", false),
    );
    return suggestions;
  }

  // ─── Case 3: Polygon/MultiPolygon ───
  if (geomType === "Polygon" || geomType === "MultiPolygon" || geomType === "GeometryCollection") {
    suggestions.push(
      make("GeoJsonLayer", "Standard Map", "Render polygon boundaries with fill and stroke", true),
    );
    return suggestions;
  }

  // ─── Case 4: Point data — choose based on row count ───
  if (geomType === "Point" || geomType === "MultiPoint" || !geomType) {
    // Very large dataset (>10K points)
    if (totalRowCount > 10000) {
      suggestions.push(
        make("ScreenGridLayer", "Screen Grid (Fast)", "Ultra-fast screen-space grid for massive datasets", true),
      );
      suggestions.push(
        make("HeatmapLayer", "Smooth Heatmap", "Density gradient surface", false),
      );
      suggestions.push(
        make("HexagonLayer", "3D Hexagon Grid", "Aggregate into 3D hexagonal bins", false),
      );
      return suggestions;
    }

    // Large dataset (500-10K points) — density layers
    if (totalRowCount > 500) {
      suggestions.push(
        make("HexagonLayer", "3D Hexagon Grid", "Aggregate point density into hexagonal bins", true),
      );
      suggestions.push(
        make("HeatmapLayer", "Smooth Heatmap", "Continuous density gradient", false),
      );
      suggestions.push(
        make("GridLayer", "Square Grid", "Aggregate into square grid cells", false),
      );
      if (totalRowCount < 5000) {
        suggestions.push(
          make("ScatterplotLayer", "Scatter Plot", "Individual colored circles", false),
        );
      }
      return suggestions;
    }

    // Medium dataset (50-500 points) — scatter + optional density
    if (totalRowCount > 50) {
      suggestions.push(
        make("ScatterplotLayer", "Scatter Plot", "Individual points as colored circles", true),
      );
      suggestions.push(
        make("HexagonLayer", "3D Hexagon Grid", "Aggregate into hexagonal density bins", false),
      );
      suggestions.push(
        make("HeatmapLayer", "Smooth Heatmap", "Gradient density surface", false),
      );
      if (geomType) {
        suggestions.push(
          make("GeoJsonLayer", "Standard Map", "Render raw geometries as-is", false),
        );
      }
      return suggestions;
    }

    // Small dataset (<50 points) — scatter or standard
    suggestions.push(
      make("ScatterplotLayer", "Scatter Plot", "Individual points as colored circles", true),
    );
    if (geomType) {
      suggestions.push(
        make("GeoJsonLayer", "Standard Map", "Render raw geometries as-is", false),
      );
    }
    return suggestions;
  }

  // Fallback
  suggestions.push(
    make("GeoJsonLayer", "Standard Map", "Render geometries as-is", true),
  );
  return suggestions;
}
