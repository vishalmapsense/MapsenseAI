/**
 * Client Tools — Navigation
 * ─────────────────────────────────────────────────────────────
 * Map navigation tools: zoom, rotate, fly-to, fit-bounds.
 * These are executed directly on the frontend (OpenLayers),
 * never routed to an external MCP server.
 *
 * Format: Standard JSON Schema (provider-agnostic).
 * Conversion to Gemini/OpenAI format happens at runtime.
 * ─────────────────────────────────────────────────────────────
 */
import type { ClientToolDefinition } from "@/config/clientTools/types";

export const NAVIGATION_TOOLS: ClientToolDefinition[] = [
  {
    type: "function",
    name: "map_zoom_in",
    description:
      "Zoom in on the map. Use when the user says 'zoom in', 'closer', 'magnify', etc.",
    parameters: {
      type: "object",
      properties: {
        levels: {
          type: "number",
          description: "Number of zoom levels to increase (default 1).",
        },
      },
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "map_zoom_out",
    description:
      "Zoom out on the map. Use when the user says 'zoom out', 'further', 'wider view', etc.",
    parameters: {
      type: "object",
      properties: {
        levels: {
          type: "number",
          description: "Number of zoom levels to decrease (default 1).",
        },
      },
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "map_set_zoom",
    description:
      "Set the map to an exact zoom level (0–20). Use when the user specifies a precise zoom level.",
    parameters: {
      type: "object",
      properties: {
        zoom: {
          type: "number",
          description: "Exact zoom level (0 = world, 20 = building).",
        },
      },
      required: ["zoom"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "map_rotate",
    description:
      "Rotate the map by a specified number of degrees. Use when the user says 'rotate', 'tilt', 'turn the map', etc.",
    parameters: {
      type: "object",
      properties: {
        degrees: {
          type: "number",
          description: "Rotation angle in degrees (positive = clockwise).",
        },
      },
      required: ["degrees"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "map_reset_rotation",
    description:
      "Reset the map rotation to 0° (north-up). Use when the user says 'reset rotation', 'face north', 'straighten', etc.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "map_fly_to",
    description:
      "Animate the map view to specific coordinates. Use when the user provides lat/lng or the LLM already knows the coordinates from a previous tool result.",
    parameters: {
      type: "object",
      properties: {
        lat: {
          type: "number",
          description: "Latitude of the target location.",
        },
        lng: {
          type: "number",
          description: "Longitude of the target location.",
        },
        zoom: {
          type: "number",
          description: "Optional zoom level to fly to (default: current zoom).",
        },
      },
      required: ["lat", "lng"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "map_fit_bounds",
    description:
      "Fit the map view to show all currently visible features. Use when the user says 'show everything', 'fit all', 'overview', etc.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
];
