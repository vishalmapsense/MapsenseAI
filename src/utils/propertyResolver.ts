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

/** Named standard CSS and vibrant UI colors */
const NAMED_COLORS: Record<string, [number, number, number]> = {
  red: [239, 68, 68],
  crimson: [220, 38, 38],
  ruby: [225, 29, 72],
  rose: [244, 63, 94],
  pink: [236, 72, 153],
  magenta: [217, 70, 239],
  fuchsia: [217, 70, 239],
  purple: [168, 85, 247],
  violet: [139, 92, 246],
  indigo: [99, 102, 241],
  blue: [59, 130, 246],
  navy: [30, 58, 138],
  darkblue: [30, 58, 138],
  royalblue: [37, 99, 235],
  sky: [14, 165, 233],
  cyan: [6, 182, 212],
  teal: [20, 184, 166],
  turquoise: [20, 184, 166],
  emerald: [16, 185, 129],
  green: [34, 197, 94],
  forestgreen: [22, 101, 52],
  darkgreen: [20, 83, 45],
  lime: [132, 204, 22],
  yellow: [234, 179, 8],
  gold: [245, 158, 11],
  amber: [245, 158, 11],
  orange: [249, 115, 22],
  coral: [251, 113, 133],
  brown: [180, 83, 9],
  maroon: [159, 18, 57],
  olive: [101, 116, 32],
  white: [255, 255, 255],
  black: [0, 0, 0],
  gray: [107, 114, 128],
  grey: [107, 114, 128],
  silver: [148, 163, 184],
  slate: [100, 116, 139],
  zinc: [113, 113, 122],
};

/**
 * Universal color parser: converts hex, named colors, RGB, RGBA tuples, or objects into [R, G, B, A] tuple.
 */
export function parseRGBAColor(color: any, defaultAlpha = 200): RGBAColor {
  if (!color) return [59, 130, 246, defaultAlpha];

  // 1. Array format [r, g, b] or [r, g, b, a]
  if (Array.isArray(color)) {
    if (color.length > 0 && typeof color[0] === "string" && (color[0].startsWith("#") || isNaN(Number(color[0])))) {
      const joined = color.join("");
      return parseRGBAColor(joined, defaultAlpha);
    }
    const r = Math.min(255, Math.max(0, Math.round(Number(color[0]) || 0)));
    const g = Math.min(255, Math.max(0, Math.round(Number(color[1]) || 0)));
    const b = Math.min(255, Math.max(0, Math.round(Number(color[2]) || 0)));
    let a = defaultAlpha;
    if (color.length >= 4 && color[3] !== undefined && color[3] !== null) {
      const rawA = Number(color[3]);
      a = rawA <= 1 && rawA > 0 ? Math.round(rawA * 255) : Math.min(255, Math.max(0, Math.round(rawA)));
    }
    return [r, g, b, a];
  }

  // 2. Object format { r, g, b, a? }
  if (typeof color === "object" && color.r !== undefined && color.g !== undefined && color.b !== undefined) {
    const r = Math.min(255, Math.max(0, Math.round(Number(color.r) || 0)));
    const g = Math.min(255, Math.max(0, Math.round(Number(color.g) || 0)));
    const b = Math.min(255, Math.max(0, Math.round(Number(color.b) || 0)));
    let a = defaultAlpha;
    if (color.a !== undefined) {
      const rawA = Number(color.a);
      a = rawA <= 1 && rawA > 0 ? Math.round(rawA * 255) : Math.min(255, Math.max(0, Math.round(rawA)));
    }
    return [r, g, b, a];
  }

  // 3. String format
  if (typeof color === "string") {
    const str = color.trim().toLowerCase();

    // Hex format #RGB, #RGBA, #RRGGBB, #RRGGBBAA
    if (str.startsWith("#")) {
      const hex = str.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : defaultAlpha;
        return [r, g, b, a];
      }
      if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : defaultAlpha;
        return [r, g, b, a];
      }
    }

    // rgb(r, g, b) or rgba(r, g, b, a)
    const rgbaMatch = str.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (rgbaMatch) {
      const r = parseInt(rgbaMatch[1], 10);
      const g = parseInt(rgbaMatch[2], 10);
      const b = parseInt(rgbaMatch[3], 10);
      let a = defaultAlpha;
      if (rgbaMatch[4] !== undefined) {
        const rawA = parseFloat(rgbaMatch[4]);
        a = rawA <= 1 ? Math.round(rawA * 255) : Math.min(255, Math.round(rawA));
      }
      return [r, g, b, a];
    }

    if (NAMED_COLORS[str]) {
      const [r, g, b] = NAMED_COLORS[str];
      return [r, g, b, defaultAlpha];
    }
  }

  return [59, 130, 246, defaultAlpha];
}

/**
 * Multi-stop gradient interpolation across N color stops.
 */
export function interpolateMultiStopGradient(
  val: number,
  min: number,
  max: number,
  stops: any[],
): RGBAColor {
  if (!stops || stops.length === 0) return [59, 130, 246, 200];
  if (stops.length === 1) return parseRGBAColor(stops[0]);

  const parsedStops = stops.map((s) => parseRGBAColor(s));
  if (isNaN(val)) return parsedStops[0];
  const range = max - min;
  if (range <= 0) return parsedStops[0];

  const t = Math.max(0, Math.min(1, (val - min) / range));
  const segments = parsedStops.length - 1;
  const segmentIdx = Math.min(segments - 1, Math.floor(t * segments));
  const segmentT = (t - segmentIdx / segments) * segments;

  const c1 = parsedStops[segmentIdx];
  const c2 = parsedStops[segmentIdx + 1];

  return [
    Math.round(c1[0] + segmentT * (c2[0] - c1[0])),
    Math.round(c1[1] + segmentT * (c2[1] - c1[1])),
    Math.round(c1[2] + segmentT * (c2[2] - c1[2])),
    Math.round(c1[3] + segmentT * (c2[3] - c1[3])),
  ];
}

/**
 * Interpolate RGBA color smoothly between min and max (supports 2-color or multi-stop gradient).
 */
export function interpolateGradient(
  val: number,
  min: number,
  max: number,
  minColor: any,
  maxColor: any,
  multiStops?: any[],
): RGBAColor {
  if (multiStops && multiStops.length >= 2) {
    return interpolateMultiStopGradient(val, min, max, multiStops);
  }
  const c1 = parseRGBAColor(minColor);
  const c2 = parseRGBAColor(maxColor);
  if (isNaN(val)) return c1;
  const range = max - min;
  if (range <= 0) return c1;
  const t = (val - min) / range;
  const clampedT = t < 0 ? 0 : t > 1 ? 1 : t;

  return [
    Math.round(c1[0] + clampedT * (c2[0] - c1[0])),
    Math.round(c1[1] + clampedT * (c2[1] - c1[1])),
    Math.round(c1[2] + clampedT * (c2[2] - c1[2])),
    Math.round(c1[3] + clampedT * (c2[3] - c1[3])),
  ];
}
