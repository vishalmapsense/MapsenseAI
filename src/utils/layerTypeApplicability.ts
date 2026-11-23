/**
 * Layer Type Applicability
 * ─────────────────────────────────────────────────────────────
 * Contains metadata for all deck.gl layer types and a function
 * to determine which layer types are applicable for a given
 * GeoJSON FeatureCollection.
 *
 * Used by: MapWorkspace.tsx → Layer Type Switcher popover
 * ─────────────────────────────────────────────────────────────
 */

import type { VisualizationLayerType } from "@/types/mcp.types";

/** Metadata for each supported deck.gl layer type */
export interface LayerTypeMeta {
  type: VisualizationLayerType;
  label: string;
  shortLabel: string;   // Short label for compact grid
  description: string;
  /** Data requirement category */
  category: "any" | "point" | "polygon" | "line" | "od" | "h3" | "geohash";
}

/** All supported deck.gl layer types with metadata */
export const ALL_LAYER_TYPES: LayerTypeMeta[] = [
  {
    type: "GeoJsonLayer",
    label: "GeoJSON Layer",
    shortLabel: "GeoJSON",
    description: "Render any geometry as-is",
    category: "any",
  },
  {
    type: "ScatterplotLayer",
    label: "Scatterplot Layer",
    shortLabel: "Scatter",
    description: "Points as colored circles",
    category: "point",
  },
  {
    type: "IconLayer",
    label: "Icon Layer",
    shortLabel: "Icon",
    description: "Point markers with icons",
    category: "point",
  },
  {
    type: "ColumnLayer",
    label: "Column Layer",
    shortLabel: "Column",
    description: "3D columns at point locations",
    category: "point",
  },
  {
    type: "HexagonLayer",
    label: "Hexagon Layer",
    shortLabel: "Hexagon",
    description: "Hex bin density aggregation",
    category: "point",
  },
  {
    type: "GridLayer",
    label: "Grid Layer",
    shortLabel: "Grid",
    description: "Square grid aggregation",
    category: "point",
  },
  {
    type: "ScreenGridLayer",
    label: "Screen Grid",
    shortLabel: "ScrGrid",
    description: "Ultra-fast screen-space grid",
    category: "point",
  },
  {
    type: "HeatmapLayer",
    label: "Heatmap Layer",
    shortLabel: "Heatmap",
    description: "Smooth density gradient",
    category: "point",
  },
  {
    type: "ContourLayer",
    label: "Contour Layer",
    shortLabel: "Contour",
    description: "Contour/isoline density bands",
    category: "point",
  },
  {
    type: "ArcLayer",
    label: "Arc Layer",
    shortLabel: "Arc",
    description: "Origin→Destination arcs",
    category: "od",
  },
  {
    type: "PathLayer",
    label: "Path Layer",
    shortLabel: "Path",
    description: "Connected line paths",
    category: "line",
  },
  {
    type: "SolidPolygonLayer",
    label: "Solid Polygon",
    shortLabel: "SolidPoly",
    description: "Filled polygons (no stroke)",
    category: "polygon",
  },
  {
    type: "H3HexagonLayer",
    label: "H3 Hexagon",
    shortLabel: "H3 Hex",
    description: "H3 hex index hexagons",
    category: "h3",
  },
  {
    type: "H3ClusterLayer",
    label: "H3 Cluster",
    shortLabel: "H3 Clstr",
    description: "H3 hex cluster groups",
    category: "h3",
  },
  {
    type: "GeohashLayer",
    label: "Geohash Layer",
    shortLabel: "Geohash",
    description: "Geohash-based grid cells",
    category: "geohash",
  },
];

/** OD column patterns */
const OD_ORIGIN = ["pickup_lng", "pickup_lat", "start_lng", "start_lat", "origin_lng", "origin_lat", "from_lng", "from_lat"];
const OD_DEST = ["dropoff_lng", "dropoff_lat", "end_lng", "end_lat", "dest_lng", "dest_lat", "to_lng", "to_lat"];

/**
 * Determine which deck.gl layer types are applicable for a given GeoJSON FeatureCollection.
 * Returns a Set of VisualizationLayerType strings that are valid for this data.
 */
export function getApplicableLayerTypes(featureCollection: any): Set<VisualizationLayerType> {
  const applicable = new Set<VisualizationLayerType>();

  // GeoJsonLayer is always applicable for any GeoJSON
  applicable.add("GeoJsonLayer");

  if (!featureCollection) return applicable;

  const features = featureCollection?.features || [];
  if (features.length === 0) return applicable;

  // Detect geometry type from first feature
  const firstGeom = features[0]?.geometry;
  const geomType = firstGeom?.type || "";

  // Collect all property keys (lowercase) across features (sample first 10)
  const propKeys = new Set<string>();
  for (let i = 0; i < Math.min(10, features.length); i++) {
    const props = features[i]?.properties;
    if (props) {
      Object.keys(props).forEach(k => propKeys.add(k.toLowerCase()));
    }
  }
  const propKeysArr = Array.from(propKeys);

  // Geometry type checks
  const isPoint = geomType === "Point" || geomType === "MultiPoint";
  const isPolygon = geomType === "Polygon" || geomType === "MultiPolygon";
  const isLine = geomType === "LineString" || geomType === "MultiLineString";

  // Check for OD columns in properties
  const hasOrigin = OD_ORIGIN.some(p => propKeysArr.some(k => k.includes(p)));
  const hasDest = OD_DEST.some(p => propKeysArr.some(k => k.includes(p)));
  const hasOD = hasOrigin && hasDest;

  // Check for H3 hex index
  const hasH3 = propKeysArr.some(k => k.includes("h3") || k === "hex_id" || k === "h3_index" || k === "hex");

  // Check for Geohash
  const hasGeohash = propKeysArr.some(k => k.includes("geohash"));

  // Check for lat/lng in properties
  const hasLatLng = propKeysArr.some(k => k === "lat" || k === "latitude" || k.endsWith("_lat")) &&
                    propKeysArr.some(k => k === "lng" || k === "longitude" || k === "lon" || k.endsWith("_lng"));

  // Point layers
  if (isPoint || hasLatLng) {
    applicable.add("ScatterplotLayer");
    applicable.add("IconLayer");
    applicable.add("ColumnLayer");
    applicable.add("HexagonLayer");
    applicable.add("GridLayer");
    applicable.add("ScreenGridLayer");
    applicable.add("HeatmapLayer");
    applicable.add("ContourLayer");
  }

  // Polygon layers
  if (isPolygon) {
    applicable.add("SolidPolygonLayer");
  }

  // Line layers
  if (isLine) {
    applicable.add("PathLayer");
  }

  // OD layers
  if (hasOD) {
    applicable.add("ArcLayer");
  }

  // H3 layers
  if (hasH3) {
    applicable.add("H3HexagonLayer");
    applicable.add("H3ClusterLayer");
  }

  // Geohash layers
  if (hasGeohash) {
    applicable.add("GeohashLayer");
  }

  return applicable;
}
