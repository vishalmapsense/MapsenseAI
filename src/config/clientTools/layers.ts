/**
 * Client Tools — Layers
 * ─────────────────────────────────────────────────────────────
 * Layer management tools: clear, toggle visibility, set base map.
 * Executed directly on the frontend (OpenLayers).
 *
 * Format: Standard JSON Schema (provider-agnostic).
 * Conversion to Gemini/OpenAI format happens at runtime.
 * ─────────────────────────────────────────────────────────────
 */

import type { ClientToolDefinition } from "./types";

export const LAYER_TOOLS: ClientToolDefinition[] = [
  {
    type: "function",
    name: "map_clear_layers",
    description:
      "Remove all data layers from the map. Use when the user says 'clear the map', 'remove all layers', 'start fresh', etc.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "map_toggle_layer",
    description:
      "Show or hide a specific data layer by its index. Use when the user says 'hide layer 1', 'show the first layer', etc.",
    parameters: {
      type: "object",
      properties: {
        layerIndex: {
          type: "number",
          description: "Zero-based index of the layer to toggle.",
        },
        visible: {
          type: "boolean",
          description: "True to show the layer, false to hide it.",
        },
      },
      required: ["layerIndex", "visible"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "map_set_base",
    description:
      "Switch the base map style. Available options: 'osm' (OpenStreetMap), 'carto-light', 'carto-dark', 'satellite'. Use when the user wants to change the map background.",
    parameters: {
      type: "object",
      properties: {
        base: {
          type: "string",
          description:
            "Base map identifier. Must be one of: 'osm', 'carto-light', 'carto-dark', 'satellite'.",
          enum: ["osm", "carto-light", "carto-dark", "satellite"],
        },
      },
      required: ["base"],
      additionalProperties: false,
    },
    strict: true,
  },
];
