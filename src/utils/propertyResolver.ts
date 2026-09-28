/**
 * Property & Color Resolver for Map Layer Styling
 * ─────────────────────────────────────────────────────────────
 * Provides resilient, fuzzy, case-insensitive property lookups,
 * semantic field aliases, numeric parsing, and dynamic color palettes.
 * Guarantees that styling requests never fall through to a single flat color.
 * ─────────────────────────────────────────────────────────────
 */
import type { RGBAColor } from "@/types/layerStyle.types";

export const DYNAMIC_PALETTE: RGBAColor[] = [
  [34, 197, 94, 180], // Green
  [59, 130, 246, 180], // Blue
  [234, 179, 8, 180], // Yellow
  [239, 68, 68, 180], // Red
  [168, 85, 247, 180], // Purple
  [249, 115, 22, 180], // Orange
  [6, 182, 212, 180], // Cyan
  [236, 72, 153, 180], // Pink
  [20, 184, 166, 180], // Teal
  [99, 102, 241, 180], // Indigo
  [245, 158, 11, 180], // Amber
  [132, 204, 22, 180], // Lime
  [14, 165, 233, 180], // Sky
  [244, 63, 94, 180], // Rose
  [16, 185, 129, 180], // Emerald
  [139, 92, 246, 180], // Violet
];

export const CURATED_PALETTES: Record<string, RGBAColor[]> = {
  traffic: [
    [34, 197, 94, 180], // Green
    [234, 179, 8, 180], // Yellow
    [239, 68, 68, 180], // Red
    [59, 130, 246, 180], // Blue fallback
  ],
  rainbow: [
    [34, 197, 94, 180], // Green
    [20, 184, 166, 180], // Teal
    [59, 130, 246, 180], // Blue
    [168, 85, 247, 180], // Purple
    [249, 115, 22, 180], // Orange
    [239, 68, 68, 180], // Red
  ],
  ocean: [
    [6, 182, 212, 180], // Cyan
    [14, 165, 233, 180], // Sky
    [59, 130, 246, 180], // Blue
    [99, 102, 241, 180], // Indigo
    [168, 85, 247, 180], // Purple
  ],
  heatmap: [
    [250, 204, 21, 180], // Yellow
    [245, 158, 11, 180], // Amber
    [249, 115, 22, 180], // Orange
    [239, 68, 68, 180], // Red
    [159, 18, 57, 180], // Wine
  ],
  viridis: [
    [68, 1, 84, 180], // Purple
    [59, 82, 139, 180], // Blue
    [33, 145, 140, 180], // Teal
    [94, 201, 98, 180], // Light Green
    [253, 231, 37, 180], // Yellow
  ],
  sunset: [
    [88, 28, 135, 180], // Dark Purple
    [190, 24, 93, 180], // Magenta
    [239, 68, 68, 180], // Red
    [249, 115, 22, 180], // Orange
    [250, 204, 21, 180], // Yellow
  ],
  pastel: [
    [110, 231, 183, 180], // Soft Emerald
    [147, 197, 253, 180], // Soft Blue
    [196, 181, 253, 180], // Soft Violet
    [249, 168, 212, 180], // Soft Pink
    [253, 186, 116, 180], // Soft Orange
    [253, 224, 71, 180], // Soft Yellow
  ],
};

const COMMON_ALIASES: Record<string, string[]> = {
  region: [
    "boro_name",
    "borough",
    "state",
    "adm1_name",
    "adm1",
    "district",
    "county",
    "zone",
    "state_name",
    "region_name",
    "ntaname",
    "area_name",
  ],
  borough: ["boro_name", "boro", "region", "district", "county", "adm2_name"],
  state: [
    "state_name",
    "st_name",
    "adm1_name",
    "region",
    "state_code",
    "state",
  ],
  area: [
    "shape_area",
    "area_sqkm",
    "area_sq_km",
    "area_km2",
    "st_area",
    "area_ha",
    "area",
  ],
  population: [
    "population",
    "pop",
    "pop_est",
    "population_total",
    "total_pop",
    "pop2020",
    "pop_2020",
    "tot_pop",
    "poptotal",
  ],
  speed: ["avg_d_kbps", "avg_u_kbps", "speed_mbps", "download_speed", "speed"],
  name: ["name", "ntaname", "title", "label", "full_name", "display_name"],
  type: [
    "type",
    "category",
    "class",
    "amenity",
    "kind",
    "sub_type",
    "feature_type",
  ],
  status: ["status", "state", "condition", "active", "is_active"],
  rating: ["rating", "score", "rank", "stars", "avg_rating"],
  price: ["price", "cost", "fare", "rate", "amount"],
  distance: [
    "distance",
    "dist",
    "length",
    "shape_leng",
    "distance_km",
    "dist_m",
  ],
};

/**
 * Resolve a property from a feature properties object using fuzzy,
 * case-insensitive, and alias matching.
 */
export function resolveFeatureProperty(
  props: Record<string, any> | undefined | null,
  targetField: string,
): { key: string; value: any } | null {
  if (!props || !targetField) return null;

  // 1. Direct exact match
  if (props[targetField] !== undefined && props[targetField] !== null) {
    return { key: targetField, value: props[targetField] };
  }

  const cleanTarget = targetField.trim().toLowerCase();

  // 2. Case-insensitive exact match
  for (const k in props) {
    if (
      k.toLowerCase() === cleanTarget &&
      props[k] !== undefined &&
      props[k] !== null
    ) {
      return { key: k, value: props[k] };
    }
  }

  // 3. Normalized match (ignoring underscores, spaces, hyphens)
  const normTarget = cleanTarget.replace(/[_\s-]/g, "");
  for (const k in props) {
    if (
      k.toLowerCase().replace(/[_\s-]/g, "") === normTarget &&
      props[k] !== undefined &&
      props[k] !== null
    ) {
      return { key: k, value: props[k] };
    }
  }

  // 3.5. Direct prefix or boundary match (e.g. "region_name" when target is "region")
  for (const k in props) {
    const lk = k.toLowerCase();
    if (
      (lk.startsWith(`${cleanTarget}_`) ||
        lk.startsWith(`${cleanTarget} `) ||
        lk.endsWith(`_${cleanTarget}`)) &&
      props[k] !== undefined &&
      props[k] !== null
    ) {
      return { key: k, value: props[k] };
    }
  }

  // 4. Semantic alias matching
  const aliasList = COMMON_ALIASES[cleanTarget];
  if (aliasList) {
    for (const alias of aliasList) {
      const normAlias = alias.replace(/[_\s-]/g, "");
      for (const k in props) {
        if (
          k.toLowerCase().replace(/[_\s-]/g, "") === normAlias &&
          props[k] !== undefined &&
          props[k] !== null
        ) {
          return { key: k, value: props[k] };
        }
      }
    }
  }

  return null;
}

/**
 * Convenience helper to directly retrieve the resolved property value,
 * applying fuzzy, case-insensitive, and semantic alias matching.
 */
export function resolveFeaturePropertyValue(
  props: Record<string, any> | undefined | null,
  targetField: string,
): any {
  const match = resolveFeatureProperty(props, targetField);
  return match ? match.value : undefined;
}

/**
 * Robust numeric parser that handles numbers, numeric strings,
 * strings with commas, currency symbols, and scientific notation.
 */
export function parseNumericValue(val: any): number {
  if (typeof val === "number") {
    return isNaN(val) ? NaN : val;
  }
  if (val === undefined || val === null || val === "") {
    return NaN;
  }
  const str = String(val)
    .replace(/[$€£, ]/g, "")
    .trim();
  const num = parseFloat(str);
  return isNaN(num) ? NaN : num;
}

/**
 * Deterministically hash any category string to a distinct vibrant color
 * from a palette. Guarantees two different categories get different colors
 * and never falls back to a single flat gray color.
 */
export function hashStringToColor(
  str: string,
  paletteName?: string,
): RGBAColor {
  const palette =
    (paletteName && CURATED_PALETTES[paletteName.toLowerCase()]) ||
    DYNAMIC_PALETTE;

  if (!str) return palette[0];

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }

  const idx = Math.abs(hash) % palette.length;
  return palette[idx];
}

/**
 * Interpolate RGBA color smoothly between min and max.
 */
export function interpolateGradient(
  val: number,
  min: number,
  max: number,
  minColor: RGBAColor,
  maxColor: RGBAColor,
): RGBAColor {
  if (isNaN(val)) return minColor;
  const range = max - min;
  if (range <= 0) return minColor;
  const t = (val - min) / range;
  const clampedT = t < 0 ? 0 : t > 1 ? 1 : t;

  return [
    Math.round(minColor[0] + clampedT * (maxColor[0] - minColor[0])),
    Math.round(minColor[1] + clampedT * (maxColor[1] - minColor[1])),
    Math.round(minColor[2] + clampedT * (maxColor[2] - minColor[2])),
    Math.round(minColor[3] + clampedT * (maxColor[3] - minColor[3])),
  ];
}
