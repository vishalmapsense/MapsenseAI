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
      "Apply data-driven, rule-based, or query-based visual styling to a map layer. Fully flexible for ANY user intent:\n" +
      "1. 'category' — Color features by categorical values, value groups, or custom rules:\n" +
      "   • Direct field: { type: 'category', field: 'status' } (auto-discovers unique categories if mapping omitted).\n" +
      "   • VALUE GROUPS (for queries like 'South aur North ke hisab se color karo'): { type: 'category', field: 'region', valueGroups: { 'South': ['Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Telangana'], 'North': ['Delhi', 'Punjab', 'Haryana', 'Uttar Pradesh', 'Himachal Pradesh', 'Rajasthan'] }, mapping: { 'South': { fillColor: [59,130,246,200] }, 'North': { fillColor: [239,68,68,200] } } }. The engine maps each state/value to its group and injects the category into features!\n" +
      "   • RULES: { type: 'category', rules: [ { category: 'South', field: 'st_nm', operator: 'in', value: ['Tamil Nadu', 'Kerala'] }, { category: 'North', field: 'st_nm', operator: 'in', value: ['Delhi', 'UP'] } ] } or with numeric/coordinate conditions [ { condition: 'lat < 20', category: 'South' } ].\n" +
      "   • FILTER + COLOR: Set dimUnmatched: true to dim unmatched features to faint gray, or hideUnmatched: true to hide them completely!\n" +
      "   • RANGES: Continuous numeric classification (e.g. speed thresholds into Best/Average/Poor).\n" +
      "2. 'gradient' — Interpolate color across a numeric range (e.g., population: low→blue, high→red).\n" +
      "3. 'solid' — Apply a single flat color to the entire layer.\n\n" +
      "IMPORTANT: Colors must be RGBA arrays [R, G, B, A] with values 0-255.",
    parameters: {
      type: "object",
      properties: {
        layerIndex: {
          type: "number",
          description:
            "Zero-based index of the map layer to apply styling to. Use 0 for the most recently added layer if unsure.",
        },
        style: {
          type: "object",
          description:
            "The style specification object. Must include a 'type' field ('category', 'gradient', or 'solid').",
          properties: {
            type: {
              type: "string",
              description: "Style type: 'category', 'gradient', or 'solid'.",
              enum: ["category", "gradient", "solid"],
            },
            field: {
              type: "string",
              description:
                "The feature property field name to use for styling. Required for 'gradient', optional if 'rules' or 'valueGroups' are provided.",
            },
            targetField: {
              type: "string",
              description:
                "Optional target property name to tag on features when assigning derived categories (e.g. 'region'). Defaults to field.",
            },
            sourceField: {
              type: "string",
              description:
                "For 'category' type with numeric ranges or valueGroups: the source property column when field is a target category name like 'region' or 'speed_grade'.",
            },
            valueGroups: {
              type: "object",
              description:
                "Group multiple property values into named categories. E.g. { 'South': ['Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Telangana'], 'North': ['Delhi', 'Punjab', 'Haryana', 'Uttar Pradesh'] }. Features matching these values are classified into the category.",
            },
            rules: {
              type: "array",
              description:
                "Condition-based rules for styling/filtering. Each rule has 'category' (string), optional 'field', 'operator' ('in'|'equals'|'contains'|'>'|'<'|'>='|'<='|'between'), 'value', optional 'condition' string (e.g. 'lat < 20'), 'fillColor', and 'label'.",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  field: { type: "string" },
                  operator: { type: "string" },
                  value: {
                    type: "string",
                    description:
                      "Target value, number, or comma-separated list of values (e.g. 'Tamil Nadu, Kerala' or '25000').",
                  },
                  values: {
                    type: "array",
                    description:
                      "Optional array of string values for 'in' operator (e.g. ['Tamil Nadu', 'Kerala']).",
                    items: { type: "string" },
                  },
                  condition: { type: "string" },
                  fillColor: { type: "array", items: { type: "number" } },
                  lineColor: { type: "array", items: { type: "number" } },
                  label: { type: "string" },
                },
                required: ["category"],
              },
            },
            dimUnmatched: {
              type: "boolean",
              description:
                "If true, features that do not match the specified rules or value groups are dimmed to faint transparent gray, highlighting the filtered/matched features.",
            },
            hideUnmatched: {
              type: "boolean",
              description:
                "If true, features that do not match the specified rules or value groups are completely hidden (transparent).",
            },
            ranges: {
              type: "array",
              description:
                "For 'category' type: optional numeric range thresholds to classify a continuous numeric field into categories (e.g. [ { min: 25000, category: 'Best' }, { min: 10000, max: 25000, category: 'Average' }, { max: 10000, category: 'Poor' } ]).",
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
                "For 'category' type: an object mapping each category value to its style. Each value should be an object with 'fillColor' (required, RGBA array), 'lineColor' (optional, RGBA array), and 'label' (optional, display name).",
            },
            defaultColor: {
              type: "array",
              description:
                "For 'category' type: fallback RGBA color for values not in the mapping. Default: [148, 163, 184, 100].",
              items: { type: "number" },
            },
            palette: {
              type: "string",
              description:
                "Optional palette name for auto-assigning distinct colors: 'rainbow' (default, multi-hue), 'traffic' (green/yellow/red for ratings/performance), 'ocean' (blues/teals), 'heatmap' (yellow to red), 'viridis' (blue to yellow), 'sunset' (purple to orange), 'pastel'.",
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
            pointRadius: {
              type: "number",
              description:
                "Optional radius in pixels for point circle features (e.g. 8).",
            },
            sizeField: {
              type: "string",
              description:
                "Optional numeric property name to scale point circle radius dynamically (e.g., 'population', 'magnitude'). Creates a proportional bubble map.",
            },
            minRadius: {
              type: "number",
              description:
                "Optional minimum circle radius for sizeField scaling (default: 4).",
            },
            maxRadius: {
              type: "number",
              description:
                "Optional maximum circle radius for sizeField scaling (default: 24).",
            },
            lineWidth: {
              type: "number",
              description:
                "Optional stroke / outline width in pixels for polygon or line features (e.g. 2 or 4).",
            },
            min: {
              type: "number",
              description:
                "For 'gradient' type: minimum value of the numeric range.",
            },
            max: {
              type: "number",
              description:
                "For 'gradient' type: maximum value of the numeric range.",
            },
            minColor: {
              type: "array",
              description:
                "For 'gradient' type: RGBA color at the minimum value.",
              items: { type: "number" },
            },
            maxColor: {
              type: "array",
              description:
                "For 'gradient' type: RGBA color at the maximum value.",
              items: { type: "number" },
            },
            fillColor: {
              type: "array",
              description: "For 'solid' type: the fill RGBA color.",
              items: { type: "number" },
            },
            lineColor: {
              type: "array",
              description: "For 'solid' type: optional line/stroke RGBA color.",
              items: { type: "number" },
            },
            opacity: {
              type: "number",
              description: "For 'solid' type: optional opacity override (0-1).",
            },
          },
          required: ["type"],
        },
      },
      required: ["layerIndex", "style"],
      additionalProperties: false,
    },
    strict: false, // Complex nested object, strict mode may interfere
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
