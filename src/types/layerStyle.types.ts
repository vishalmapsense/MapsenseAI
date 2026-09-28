/**
 * Layer Style Types
 * ─────────────────────────────────────────────────────────────
 * Defines the styling specification for map layers.
 * Supports three modes:
 *   1. Category — Color features by a categorical field (e.g. "Best" → Green)
 *   2. Gradient — Interpolate color by a numeric field range
 *   3. Solid   — Apply a flat color to the entire layer
 *
 * The AI agent generates these specs via the `map_style_layer` tool,
 * and users can edit them via the LayerStylePanel UI.
 * ─────────────────────────────────────────────────────────────
 */

/** RGBA color tuple [R, G, B, A] with values 0-255 */
export type RGBAColor = [number, number, number, number];

/** Common visual properties applicable to any layer style */
export interface BaseStyleProperties {
  /** Optional fixed point radius for point features */
  pointRadius?: number;
  /** Optional numeric field to scale point radius (bubble map) */
  sizeField?: string;
  minRadius?: number;
  maxRadius?: number;
  /** Optional stroke width in pixels */
  lineWidth?: number;
  /** If true, features that do not match the specified rules or categories are dimmed to a faint transparent tone */
  dimUnmatched?: boolean;
  /** If true, unmatched features are completely hidden/transparent */
  hideUnmatched?: boolean;
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
  fillColor?: RGBAColor;
  /** Stroke/line color for features matching this rule */
  lineColor?: RGBAColor;
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
  /** Optional palette preset name (e.g. "traffic", "rainbow", "ocean", "heatmap", "viridis", "pastel") */
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
    fillColor: RGBAColor;
    lineColor?: RGBAColor;
    label?: string;
  }>;
  /** Fallback color for values not in the mapping */
  defaultColor?: RGBAColor;
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
  minColor: RGBAColor;
  /** Color at the maximum value */
  maxColor: RGBAColor;
  /** Optional palette preset name (e.g. "viridis", "heatmap", "cool", "warm", "turbo") */
  palette?: string;
}

/** Solid color override — applies a single color to the entire layer */
export interface SolidStyle extends BaseStyleProperties {
  type: "solid";
  fillColor: RGBAColor;
  lineColor?: RGBAColor;
  opacity?: number;
}

/** Union type for all supported layer styles */
export type LayerStyle = CategoryStyle | GradientStyle | SolidStyle;
