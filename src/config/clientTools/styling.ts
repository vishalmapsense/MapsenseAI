/**
 * Client Tools — Styling
 * ─────────────────────────────────────────────────────────────
 * Layer styling tools: apply data-driven visual styles to map layers.
 * Supports category coloring, gradient coloring, and solid color overrides.
 * Executed directly on the frontend (DeckGL).
 *
 * Format: Standard JSON Schema (provider-agnostic).
 * Conversion to Gemini/OpenAI format happens at runtime.
 * ─────────────────────────────────────────────────────────────
 */
import type { ClientToolDefinition } from "@/config/clientTools/types";

export const STYLING_TOOLS: ClientToolDefinition[] = [
  {
    type: "function",
    name: "map_style_layer",
    description:
      "Apply custom, data-driven, 3D, or rule-based visual styling to a map layer with 100% deterministic output.\n" +
      "DETERMINISM MANDATE: The layer type and colors you pass here will appear on the map, and MUST be the EXACT ones you describe in chat. Never guess or let colors be random.\n\n" +
      "1. LAYER TYPES (visualizationType):\n" +
      "   • 'GeoJsonLayer' — Standard vector boundaries, polygons, lines, or points. Supports 3D extrusion (extruded: true) and outlines (filled: false).\n" +
      "   • 'HeatmapLayer' — Smooth density heat surface for dense points.\n" +
      "   • 'HexagonLayer' — 3D hexagonal bins with dynamic height.\n" +
      "   • 'ScatterplotLayer' — High-performance circle points with custom radius.\n" +
      "   • 'GridLayer' — 3D rectangular grid cell aggregation.\n\n" +
      "2. DETERMINISTIC COLOR OPTIONS (Available Hex & Names):\n" +
      "   • Red: '#ef4444' | Crimson: '#dc2626' | Ruby: '#e11d48' | Rose: '#f43f5e'\n" +
      "   • Blue: '#3b82f6' | Royal: '#2563eb' | Navy: '#1e3a8a' | Sky: '#0ea5e9'\n" +
      "   • Green: '#22c55e' | Emerald: '#10b981' | Forest: '#166534' | Lime: '#84cc16'\n" +
      "   • Yellow: '#eab308' | Gold: '#f59e0b'\n" +
      "   • Orange: '#f97316' | Amber: '#d97706'\n" +
      "   • Purple: '#a855f7' | Violet: '#8b5cf6' | Indigo: '#6366f1'\n" +
      "   • Cyan: '#06b6d4' | Teal: '#14b8a6' | Turquoise: '#2dd4bf'\n" +
      "   • Pink: '#ec4899' | Magenta: '#d946ef'\n" +
      "   • Neutral: Slate '#64748b' | Dark '#1e293b' | White '#ffffff'\n\n" +
      "3. STYLING MODES:\n" +
      "   • 'category' — Explicit category mapping: mapping: { 'High': { fillColor: '#ef4444' }, 'Low': { fillColor: '#22c55e' } }. Or valueGroups: { 'South': [...], 'North': [...] } with matching mapping.\n" +
      "   • 'gradient' — Smooth numeric ramp: field: 'pop', minColor: '#3b82f6', maxColor: '#ef4444' (or multi-stop colorRange).\n" +
      "   • 'solid' — Flat color or boundary outline: fillColor: '#3b82f6' (or filled: false, stroked: true, lineColor: 'gold', lineWidth: 3).\n" +
      "   • 3D EXTRUSION — extruded: true, elevationField: 'pop', elevationScale: 0.5 (auto-tilts camera to 3D perspective).",
    parameters: {
      type: "object",
      properties: {
        layerIndex: {
          type: "number",
          description:
            "Zero-based index of the map layer to apply styling to. Use 0 for the most recently added layer if unsure.",
        },
        layerName: {
          type: "string",
          description:
            "Optional layer name or keyword to target (e.g. 'tracts', 'population', 'delhi'). If provided, automatically finds the matching layer.",
        },
        style: {
          type: "object",
          description:
            "The style specification object. Includes 'type' ('category', 'gradient', or 'solid') plus styling properties.",
          properties: {
            type: {
              type: "string",
              description: "Style type: 'category', 'gradient', 'solid', 'heatmap', or 'hexagon'.",
              enum: ["category", "gradient", "solid", "heatmap", "hexagon"],
            },
            visualizationType: {
              type: "string",
              description:
                "Optional Deck.gl layer type switch: 'GeoJsonLayer', 'HexagonLayer', 'HeatmapLayer', 'ScatterplotLayer', or 'GridLayer'.",
              enum: ["GeoJsonLayer", "HexagonLayer", "HeatmapLayer", "ScatterplotLayer", "GridLayer"],
            },
            field: {
              type: "string",
              description:
                "The feature property field name to use for styling (e.g. 'population', 'state', 'density').",
            },
            targetField: {
              type: "string",
              description:
                "Optional target property name to tag on features when assigning derived categories.",
            },
            sourceField: {
              type: "string",
              description:
                "For 'category' with valueGroups: source property column if field is a target category name.",
            },
            valueGroups: {
              type: "object",
              description:
                "Group multiple property values into named categories. E.g. { 'South': ['Tamil Nadu', 'Kerala'], 'North': ['Delhi', 'UP'] }.",
            },
            rules: {
              type: "array",
              description:
                "Condition-based rules for styling/filtering. Each rule has 'category', optional 'field', 'operator', 'value', 'fillColor', 'lineColor', and 'label'.",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  field: { type: "string" },
                  operator: { type: "string" },
                  value: {
                    type: "string",
                    description: "Target value, number, or comma-separated list of values.",
                  },
                  values: {
                    type: "array",
                    description: "Optional array of string values for 'in' operator.",
                    items: { type: "string" },
                  },
                  condition: { type: "string" },
                  fillColor: {
                    type: "string",
                    description: "Fill color: hex code ('#ef4444'), CSS color ('crimson'), or RGBA array.",
                  },
                  lineColor: {
                    type: "string",
                    description: "Line color: hex code, CSS color, or RGBA array.",
                  },
                  label: { type: "string" },
                },
                required: ["category"],
              },
            },
            dimUnmatched: {
              type: "boolean",
              description:
                "If true, features not matching the rules or value groups are dimmed to faint gray.",
            },
            hideUnmatched: {
              type: "boolean",
              description:
                "If true, unmatched features are completely hidden (transparent).",
            },
            ranges: {
              type: "array",
              description:
                "For 'category' type: numeric threshold ranges (e.g. [ { min: 50000, category: 'High' }, { max: 10000, category: 'Low' } ]).",
              items: {
                type: "object",
                properties: {
                  min: { type: "number" },
                  max: { type: "number" },
                  category: { type: "string" },
                },
                required: ["category"],
              },
            },
            mapping: {
              type: "object",
              description:
                "For 'category' type: object mapping each category value to its style ({ 'High': { fillColor: '#ef4444' } }).",
            },
            defaultColor: {
              type: "string",
              description:
                "Fallback color for values not in the mapping (hex, CSS name, or RGBA array).",
            },
            palette: {
              type: "string",
              description:
                "Curated color palette: 'rainbow', 'traffic', 'ocean', 'heatmap', 'viridis', 'sunset', 'pastel'.",
              enum: [
                "rainbow",
                "traffic",
                "ocean",
                "heatmap",
                "viridis",
                "sunset",
                "pastel",
              ],
            },
            extruded: {
              type: "boolean",
              description:
                "Enable 3D extruded polygons/polygons with height. Automatically tilts the camera to 3D perspective.",
            },
            elevationField: {
              type: "string",
              description:
                "Property field name for 3D extrusion height (e.g. 'population', 'density', 'count', 'score').",
            },
            elevationScale: {
              type: "number",
              description:
                "Multiplier scale for 3D height extrusion (e.g. 0.1, 1, 10, 50). Default is 1.",
            },
            wireframe: {
              type: "boolean",
              description: "Whether to render wireframe edges on 3D extruded polygons.",
            },
            filled: {
              type: "boolean",
              description:
                "Whether to fill polygon interior. Set to false for outline-only / boundary highlighting.",
            },
            stroked: {
              type: "boolean",
              description:
                "Whether to draw borders/strokes on polygons.",
            },
            fillColor: {
              type: "string",
              description:
                "Fill color (hex code like '#3b82f6', CSS color name like 'gold', or RGBA array [r, g, b, a]).",
            },
            lineColor: {
              type: "string",
              description:
                "Border/stroke color (hex code like '#ef4444', CSS color name like 'crimson', or RGBA array).",
            },
            lineWidth: {
              type: "number",
              description:
                "Stroke / outline width in pixels for polygon or line features (e.g. 2, 4).",
            },
            opacity: {
              type: "number",
              description: "Overall layer opacity between 0.0 and 1.0.",
            },
            pointRadius: {
              type: "number",
              description:
                "Radius in pixels for point circle features (e.g. 8).",
            },
            sizeField: {
              type: "string",
              description:
                "Property name to scale point circle radius dynamically (bubble map).",
            },
            minRadius: {
              type: "number",
              description:
                "Minimum circle radius for sizeField scaling (default: 4).",
            },
            maxRadius: {
              type: "number",
              description:
                "Maximum circle radius for sizeField scaling (default: 24).",
            },
            min: {
              type: "number",
              description:
                "For 'gradient' type: minimum value of numeric range.",
            },
            max: {
              type: "number",
              description:
                "For 'gradient' type: maximum value of numeric range.",
            },
            minColor: {
              type: "string",
              description:
                "For 'gradient' type: start color at minimum value (hex, CSS color, or RGBA array).",
            },
            maxColor: {
              type: "string",
              description:
                "For 'gradient' type: end color at maximum value (hex, CSS color, or RGBA array).",
            },
            colorRange: {
              type: "array",
              description:
                "Multi-stop color palette for gradients, heatmaps, or hexagons (e.g. ['#1e3a8a', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']).",
            },
          },
          required: ["type"],
        },
      },
      required: ["style"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "map_clear_layer_style",
    description:
      "Remove all visual styling from a map layer, returning it to the default blue color. Use when the user asks to reset colors, remove styling, or go back to default appearance.",
    parameters: {
      type: "object",
      properties: {
        layerIndex: {
          type: "number",
          description:
            "Zero-based index of the map layer to clear styling from.",
        },
      },
      required: ["layerIndex"],
      additionalProperties: false,
    },
    strict: true,
  },
];
