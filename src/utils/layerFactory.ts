/**
 * Layer Factory
 * ─────────────────────────────────────────────────────────────
 * Creates deck.gl visualization layer instances from a layer type
 * and data array. This is the single source of truth for layer
 * construction — DeckGLMap.tsx calls this to render visualization layers.
 * ─────────────────────────────────────────────────────────────
 */

import { HexagonLayer, HeatmapLayer, GridLayer, ScreenGridLayer, ContourLayer } from "@deck.gl/aggregation-layers";
import { ScatterplotLayer, ArcLayer, PathLayer, ColumnLayer, IconLayer, SolidPolygonLayer } from "@deck.gl/layers";
import { H3HexagonLayer, H3ClusterLayer, GeohashLayer } from "@deck.gl/geo-layers";
import type { VisualizationLayerType } from "@/types/mcp.types";

/** Default color ramp for density layers (blue → cyan → green → yellow → red) */
const DEFAULT_COLOR_RANGE: [number, number, number][] = [
  [1, 152, 189],
  [73, 227, 206],
  [216, 254, 181],
  [254, 237, 177],
  [254, 173, 84],
  [209, 55, 78],
];

export interface VisualizationLayerConfig {
  radius?: number;            // For HexagonLayer/GridLayer cell size (meters)
  elevationScale?: number;    // 3D extrusion multiplier
  extruded?: boolean;         // Enable 3D
  opacity?: number;           // 0-1
  colorRange?: [number, number, number][];
  coverage?: number;          // 0-1, gap between hexagons/grid cells
  upperPercentile?: number;   // Clip outliers
  intensity?: number;         // HeatmapLayer intensity
  radiusPixels?: number;      // HeatmapLayer blur radius
  getWeight?: (d: any) => number;
}

/**
 * Extract [lng, lat] position from various data formats.
 * Handles GeoJSON Point features and flat {lng, lat} objects.
 */
const getPosition = (d: any): [number, number] => {
  // GeoJSON Feature with Point geometry
  if (d.geometry?.type === "Point" && Array.isArray(d.geometry.coordinates)) {
    return d.geometry.coordinates as [number, number];
  }
  // Flat coordinate arrays
  if (Array.isArray(d.position)) return d.position;
  if (Array.isArray(d.coordinates)) return d.coordinates;
  // Named fields
  if (typeof d.lng === "number" && typeof d.lat === "number") return [d.lng, d.lat];
  if (typeof d.longitude === "number" && typeof d.latitude === "number") return [d.longitude, d.latitude];
  if (typeof d.lon === "number" && typeof d.lat === "number") return [d.lon, d.lat];
  // Pickup coordinates (taxi data pattern)
  if (typeof d.pickup_longitude === "number" && typeof d.pickup_latitude === "number") {
    return [d.pickup_longitude, d.pickup_latitude];
  }
  return [0, 0];
};

/**
 * For ArcLayer: extract source (origin) position
 */
const getSourcePosition = (d: any): [number, number] => {
  if (typeof d.pickup_longitude === "number" && typeof d.pickup_latitude === "number") {
    return [d.pickup_longitude, d.pickup_latitude];
  }
  if (typeof d.start_lng === "number" && typeof d.start_lat === "number") {
    return [d.start_lng, d.start_lat];
  }
  if (typeof d.origin_lng === "number" && typeof d.origin_lat === "number") {
    return [d.origin_lng, d.origin_lat];
  }
  if (typeof d.from_lng === "number" && typeof d.from_lat === "number") {
    return [d.from_lng, d.from_lat];
  }
  return getPosition(d);
};

/**
 * For ArcLayer: extract target (destination) position
 */
const getTargetPosition = (d: any): [number, number] => {
  if (typeof d.dropoff_longitude === "number" && typeof d.dropoff_latitude === "number") {
    return [d.dropoff_longitude, d.dropoff_latitude];
  }
  if (typeof d.end_lng === "number" && typeof d.end_lat === "number") {
    return [d.end_lng, d.end_lat];
  }
  if (typeof d.dest_lng === "number" && typeof d.dest_lat === "number") {
    return [d.dest_lng, d.dest_lat];
  }
  if (typeof d.to_lng === "number" && typeof d.to_lat === "number") {
    return [d.to_lng, d.to_lat];
  }
  return [0, 0];
};

/**
 * Creates a deck.gl layer from the given type, data, and optional configuration.
 * Returns null for unknown/invalid inputs.
 */
export function createVisualizationLayer(
  layerType: VisualizationLayerType,
  data: any[],
  queryId: string,
  config: VisualizationLayerConfig = {},
): any {
  if (!data || data.length === 0) return null;

  const {
    radius = 200,
    elevationScale = 4,
    extruded = true,
    opacity = 0.8,
    colorRange = DEFAULT_COLOR_RANGE,
    coverage = 0.9,
    upperPercentile = 100,
    intensity = 1,
    radiusPixels = 30,
  } = config;

  const layerId = `viz-${layerType}-${queryId}`;

  switch (layerType) {
    case "HexagonLayer":
      return new HexagonLayer({
        id: layerId,
        data,
        pickable: true,
        extruded,
        radius,
        elevationScale,
        getPosition,
        colorRange,
        coverage,
        upperPercentile,
        opacity,
        getElevationWeight: config.getWeight || ((d: any) => d.weight || 1),
        getColorWeight: config.getWeight || ((d: any) => d.weight || 1),
      });

    case "HeatmapLayer":
      return new HeatmapLayer({
        id: layerId,
        data,
        getPosition,
        getWeight: config.getWeight || ((d: any) => d.weight || 1),
        intensity,
        radiusPixels,
        opacity,
        colorRange,
      });

    case "GridLayer":
      return new GridLayer({
        id: layerId,
        data,
        pickable: true,
        extruded,
        cellSize: radius,
        elevationScale,
        getPosition,
        colorRange,
        coverage,
        opacity,
      });

    case "ScreenGridLayer":
      return new ScreenGridLayer({
        id: layerId,
        data,
        pickable: false,
        getPosition,
        cellSizePixels: 20,
        opacity: 0.7,
        colorRange,
      });

    case "ScatterplotLayer": {
      const pointRadius = typeof config.radius === "number" && !isNaN(config.radius)
        ? config.radius
        : (typeof config.radiusPixels === "number" && !isNaN(config.radiusPixels) ? config.radiusPixels : 30);

      return new ScatterplotLayer({
        id: layerId,
        data,
        pickable: true,
        getPosition,
        radiusUnits: "pixels",
        getRadius: (d: any) => {
          if (typeof config.radius === "number" && !isNaN(config.radius)) {
            return config.radius;
          }
          if (typeof config.radiusPixels === "number" && !isNaN(config.radiusPixels)) {
            return config.radiusPixels;
          }
          if (typeof d?.radius === "number") return d.radius;
          if (typeof d?.properties?.radius === "number") return d.properties.radius;
          return pointRadius;
        },
        getFillColor: (d: any) => {
          if (Array.isArray(d?.fillColor)) return d.fillColor;
          if (Array.isArray(d?.color)) return d.color;
          if (Array.isArray(d?.properties?.fillColor)) return d.properties.fillColor;
          if (Array.isArray(d?.properties?.color)) return d.properties.color;
          return [14, 165, 233, 180];  // sky-500
        },
        getLineColor: (d: any) => {
          if (Array.isArray(d?.lineColor)) return d.lineColor;
          if (Array.isArray(d?.properties?.lineColor)) return d.properties.lineColor;
          return [14, 165, 233, 255];
        },
        stroked: true,
        lineWidthMinPixels: 1,
        radiusMinPixels: 1,
        radiusMaxPixels: 1000,
        opacity,
        updateTriggers: {
          getRadius: [pointRadius, config.radius, config.radiusPixels],
        },
      });
    }

    case "ArcLayer":
      return new ArcLayer({
        id: layerId,
        data,
        pickable: true,
        getSourcePosition,
        getTargetPosition,
        getSourceColor: [14, 165, 233, 200],   // blue origin
        getTargetColor: [239, 68, 68, 200],     // red destination
        getWidth: 1.5,
        opacity,
      });

    case "PathLayer":
      return new PathLayer({
        id: layerId,
        data,
        pickable: true,
        getPath: (d: any) => {
          if (d.path) return d.path;
          if (d.geometry?.type === "LineString") return d.geometry.coordinates;
          if (d.geometry?.type === "MultiLineString") return d.geometry.coordinates[0];
          return [];
        },
        getColor: [14, 165, 233, 200],
        getWidth: 3,
        widthMinPixels: 2,
        opacity,
      });

    case "ColumnLayer":
      return new ColumnLayer({
        id: layerId,
        data,
        pickable: true,
        extruded: true,
        getPosition,
        diskResolution: 12,
        radius: radius / 2,
        elevationScale,
        getElevation: config.getWeight || ((d: any) => d.weight || d.value || d.count || 100),
        getFillColor: [14, 165, 233, 200],
        opacity,
      });

    case "IconLayer":
      return new IconLayer({
        id: layerId,
        data,
        pickable: true,
        getPosition,
        getIcon: () => 'marker',
        iconAtlas: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png',
        iconMapping: {
          marker: { x: 0, y: 0, width: 128, height: 128, anchorY: 128, mask: true }
        },
        getSize: 30,
        getColor: [14, 165, 233, 230],
        sizeScale: 1,
        opacity,
      });

    case "SolidPolygonLayer": {
      const isPolygonExtruded = config.extruded !== undefined ? Boolean(config.extruded) : true;
      const polyElevationScale = typeof config.elevationScale === "number" ? config.elevationScale : elevationScale;

      return new SolidPolygonLayer({
        id: layerId,
        data,
        pickable: true,
        filled: true,
        extruded: isPolygonExtruded,
        wireframe: isPolygonExtruded,
        elevationScale: polyElevationScale,
        getElevation: (d: any) => {
          if (typeof config.getWeight === "function") return config.getWeight(d);
          if (typeof d.elevation === "number") return d.elevation;
          if (typeof d.height === "number") return d.height;
          if (typeof d.depth === "number") return d.depth;
          if (typeof d.properties?.elevation === "number") return d.properties.elevation;
          if (typeof d.properties?.height === "number") return d.properties.height;
          if (typeof d.properties?.weight === "number") return d.properties.weight;
          if (typeof d.properties?.value === "number") return d.properties.value;
          if (typeof d.weight === "number") return d.weight;
          if (typeof d.value === "number") return d.value;
          return 100; // Base default elevation in meters
        },
        getPolygon: (d: any) => {
          if (d.polygon) return d.polygon;
          if (d.geometry?.type === "Polygon") return d.geometry.coordinates;
          if (d.geometry?.type === "MultiPolygon") return d.geometry.coordinates[0];
          if (Array.isArray(d.coordinates)) return d.coordinates;
          return [];
        },
        getFillColor: (d: any, { index }: any) => {
          if (config.colorRange && config.colorRange.length > 0) {
            const rgb = config.colorRange[index % config.colorRange.length];
            return [rgb[0], rgb[1], rgb[2], Math.round(opacity * 200)];
          }
          return [59, 130, 246, Math.round(opacity * 180)];
        },
        getLineColor: (d: any, { index }: any) => {
          if (config.colorRange && config.colorRange.length > 0) {
            const rgb = config.colorRange[index % config.colorRange.length];
            return [rgb[0], rgb[1], rgb[2], 255];
          }
          return [30, 64, 175, 255];
        },
        opacity,
        updateTriggers: {
          extruded: [isPolygonExtruded],
          elevationScale: [polyElevationScale],
          getFillColor: [config.colorRange, opacity],
          getLineColor: [config.colorRange],
          getElevation: [config.getWeight],
        },
      });
    }

    case "ContourLayer":
      return new ContourLayer({
        id: layerId,
        data,
        pickable: true,
        getPosition,
        contours: [
          { threshold: 1, color: [1, 152, 189, 180], strokeWidth: 1 },
          { threshold: 5, color: [73, 227, 206, 180], strokeWidth: 2 },
          { threshold: 10, color: [216, 254, 181, 180], strokeWidth: 2 },
          { threshold: 25, color: [254, 237, 177, 180], strokeWidth: 3 },
          { threshold: 50, color: [254, 173, 84, 180], strokeWidth: 3 },
          { threshold: 100, color: [209, 55, 78, 180], strokeWidth: 4 },
        ],
        cellSize: radius,
        opacity,
      });

    case "H3HexagonLayer":
      return new H3HexagonLayer({
        id: layerId,
        data,
        pickable: true,
        filled: true,
        extruded,
        elevationScale,
        getHexagon: (d: any) => d.h3 || d.hex_id || d.h3_index || d.hex || '',
        getFillColor: [14, 165, 233, 160],
        getElevation: config.getWeight || ((d: any) => d.weight || d.value || d.count || 1),
        opacity,
      });

    case "H3ClusterLayer":
      return new H3ClusterLayer({
        id: layerId,
        data,
        pickable: true,
        filled: true,
        stroked: true,
        getHexagons: (d: any) => d.hexagons || (d.h3 ? [d.h3] : []),
        getFillColor: [14, 165, 233, 120],
        getLineColor: [14, 165, 233, 255],
        lineWidthMinPixels: 1,
        opacity,
      });

    case "GeohashLayer":
      return new GeohashLayer({
        id: layerId,
        data,
        pickable: true,
        filled: true,
        extruded,
        elevationScale,
        getGeohash: (d: any) => d.geohash || '',
        getFillColor: [14, 165, 233, 160],
        getElevation: config.getWeight || ((d: any) => d.weight || d.value || d.count || 1),
        opacity,
      });

    case "GeoJsonLayer":
    default:
      // GeoJsonLayer is handled by the existing mapFeatures pipeline.
      // Return null so the caller knows to fall back to the default path.
      return null;
  }
}
