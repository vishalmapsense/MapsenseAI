/**
 * Layer Style Types
 * ─────────────────────────────────────────────────────────────
 * Defines the styling specification for map layers.
 * Supports:
 *   1. Category — Color features by categorical fields, custom rules, or value groups
 *   2. Gradient — Interpolate color across numeric fields (2-color or multi-stop)
 *   3. Solid   — Apply a flat color / custom outline to the layer
 *   4. 3D Extrusion — Dynamic 3D elevation height based on numeric properties
 *   5. Visualization Switching — Convert layer to Hexagon, Heatmap, or Scatterplot
 *
 * The AI agent generates these specs via the `map_style_layer` tool,
 * and users can edit them via the LayerStylePanel UI.
 * ─────────────────────────────────────────────────────────────
 */

/** RGBA color tuple [R, G, B, A] with values 0-255 */
export type RGBAColor = [number, number, number, number];

/** Flexible color input accepted from agents: RGBA tuple, RGB tuple, hex string (#fff, #3b82f6), or named CSS color */
export type ColorInput = RGBAColor | [number, number, number] | string;

/** Common visual properties applicable to any layer style */
export interface BaseStyleProperties {
  /** Optional fixed point radius for point features */
  pointRadius?: number;
  /** Optional numeric field to scale point radius (bubble map) */
  sizeField?: string;
  minRadius?: number;
  maxRadius?: number;
  /** Optional stroke / outline width in pixels */
  lineWidth?: number;
  /** Optional stroke / outline color override */
  lineColor?: ColorInput;
  /** Whether to draw filled polygons (default: true). Set to false for outline-only highlight. */
  filled?: boolean;
  /** Whether to draw stroke / polygon outlines (default: true) */
  stroked?: boolean;
  /** Overall layer opacity (0.0 to 1.0 or 0 to 255) */
  opacity?: number;
  /** If true, features that do not match the specified rules or categories are dimmed to a faint transparent tone */
  dimUnmatched?: boolean;
  /** If true, unmatched features are completely hidden/transparent */
  hideUnmatched?: boolean;
  /** If true, enables 3D polygon extrusion / bar height on the layer */
  extruded?: boolean;
  /** Numeric property column to compute 3D elevation height from (e.g. 'population', 'density', 'score') */
  elevationField?: string;
  /** Elevation multiplier scale for 3D extrusion (default: 1) */
  elevationScale?: number;
  /** Draw wireframe outlines on 3D extruded polygons */
  wireframe?: boolean;
  /** Target visualization layer type (GeoJsonLayer, HexagonLayer, HeatmapLayer, ScatterplotLayer, GridLayer) */
  visualizationType?: "GeoJsonLayer" | "HexagonLayer" | "HeatmapLayer" | "ScatterplotLayer" | "GridLayer";
}

/** Individual rule for condition-based styling */
export interface StyleRule {
  /** Target category name (e.g. 'South', 'North', 'High', 'Filtered') */
  category: string;
  /** Feature property field to inspect (e.g. 'st_nm', 'state', 'lat', 'population') */
  field?: string;
  /** Comparison operator */
  operator?: "in" | "equals" | "==" | "!=" | "contains" | "includes" | ">" | "<" | ">=" | "<=" | "between";
  /** Values to test against (e.g. ['Tamil Nadu', 'Kerala'], or 'Delhi', or 25000, or [10, 50]) */
  value?: any;
  /** Or a SQL/expression-like condition string (e.g. "lat < 20", "state IN ('Tamil Nadu', 'Kerala')") */
  condition?: string;
  /** Fill color for features matching this rule */
  fillColor?: ColorInput;
  /** Stroke/line color for features matching this rule */
  lineColor?: ColorInput;
  /** Label to show in legend */
  label?: string;
}

/** Category-based coloring — maps discrete field values, value groups, or rules to colors */
export interface CategoryStyle extends BaseStyleProperties {
  type: "category";
  /** The feature property field to categorize by (e.g. "region", "status", "boro_name") */
  field: string;
  /** Optional source numeric field name if classifying a numeric column into named categories */
  sourceField?: string;
  /** Optional target property name to inject into feature properties (defaults to field) */
  targetField?: string;
  /** Optional palette preset name (e.g. "traffic", "rainbow", "ocean", "heatmap", "viridis", "sunset", "pastel") */
  palette?: string;
  /**
   * Group multiple property values into named categories.
   * E.g. { "South": ["Tamil Nadu", "Kerala", "Karnataka"], "North": ["Delhi", "Punjab", "Haryana"] }
   */
  valueGroups?: Record<string, string[]>;
  /**
   * Array of explicit condition-based rules for complex styling/filtering.
   */
  rules?: StyleRule[];
  /** Optional numeric range thresholds for classifying continuous values into categories */
  ranges?: Array<{
    min?: number;
    max?: number;
    category: string;
  }>;
  /** Map of field value or category name → visual style */
  mapping: Record<string, {
    fillColor: ColorInput;
    lineColor?: ColorInput;
    label?: string;
  }>;
  /** Fallback color for values not in the mapping */
  defaultColor?: ColorInput;
}

/** Gradient coloring — interpolates color across a numeric range */
export interface GradientStyle extends BaseStyleProperties {
  type: "gradient";
  /** The numeric feature property field (e.g. "population", "avg_d_kbps", "shape_area") */
  field: string;
  /** Minimum value of the range */
  min: number;
  /** Maximum value of the range */
  max: number;
  /** Color at the minimum value */
  minColor: ColorInput;
  /** Color at the maximum value */
  maxColor: ColorInput;
  /** Optional palette preset name (e.g. "viridis", "heatmap", "cool", "warm", "turbo", "traffic") */
  palette?: string;
  /** Optional array of color stops for multi-stop gradient (e.g. [green, yellow, red]) */
  colorRange?: ColorInput[];
}

/** Solid color override — applies a single color to the entire layer */
export interface SolidStyle extends BaseStyleProperties {
  type: "solid";
  fillColor: ColorInput;
  lineColor?: ColorInput;
  opacity?: number;
}

/** Heatmap style specification */
export interface HeatmapStyle extends BaseStyleProperties {
  type: "heatmap";
  field?: string;
  radiusPixels?: number;
  intensity?: number;
  colorRange?: ColorInput[];
}

/** Hexagon 3D aggregation style specification */
export interface HexagonStyle extends BaseStyleProperties {
  type: "hexagon";
  field?: string;
  radius?: number;
  elevationScale?: number;
  extruded?: boolean;
  colorRange?: ColorInput[];
}

/** Union type for all supported layer styles */
export type LayerStyle = CategoryStyle | GradientStyle | SolidStyle | HeatmapStyle | HexagonStyle;
