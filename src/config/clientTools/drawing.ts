import type { ClientToolDefinition } from "@/config/clientTools/types";
export const DRAWING_TOOLS: ClientToolDefinition[] = [
  // Markers
  {
    type: "function",
    name: "map_add_marker",
    description: "Add a marker (pin) at specific coordinates. Determine the lat/lng from the user's scenario (e.g., if they ask for a city or place, find its coordinates). Provide an appropriate zoom level (e.g., 12 for cities, 16 for specific buildings). If zoom is not specified, default to 14.",
    parameters: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude of the location" },
        lng: { type: "number", description: "Longitude of the location" },
        zoom: { type: "number", description: "Appropriate zoom level (default 14)" },
        label: { type: "string", description: "Optional label for the marker" }
      },
      required: ["lat", "lng"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "map_remove_marker",
    description: "Remove a marker from the map.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "map_move_marker",
    description: "Move an existing marker to new coordinates.",
    parameters: {
      type: "object",
      properties: {
        lat: { type: "number", description: "New Latitude" },
        lng: { type: "number", description: "New Longitude" }
      },
      required: ["lat", "lng"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "map_add_geojson",
    description: "Render any GeoJSON data onto the map. Handles ALL geometry types: Point, MultiPoint, LineString, MultiLineString (routes/paths), Polygon, MultiPolygon, GeometryCollection, as well as GeoJSON Feature and FeatureCollection objects. Use this for search results, geocoded locations, routes/directions, isochrones, buffer zones, administrative boundaries, or any spatial data returned by an MCP tool. Pass the raw GeoJSON exactly as received — it will be normalized automatically.",
    parameters: {
      type: "object",
      properties: {
        geojson: { type: "object", description: "A valid GeoJSON object: Feature, FeatureCollection, or raw geometry (Point, LineString, Polygon, MultiPolygon, etc.)" },
        label: { type: "string", description: "Optional name or label for the data layer." }
      },
      required: ["geojson"],
      additionalProperties: false
    },
    strict: true
  },
  
  // Interactive Drawing Modes
  {
    type: "function",
    name: "map_draw_point",
    description: "Activate Point drawing mode so the user can draw points on the map.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  },
  {
    type: "function",
    name: "map_draw_line",
    description: "Activate Line (LineString) drawing mode so the user can draw lines.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  },
  {
    type: "function",
    name: "map_draw_polygon",
    description: "Activate Polygon drawing mode so the user can draw custom polygons.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  },
  {
    type: "function",
    name: "map_draw_circle",
    description: "Activate Circle drawing mode.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  },
  {
    type: "function",
    name: "map_draw_rectangle",
    description: "Activate Rectangle drawing mode.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  },

  // Editing Modes
  {
    type: "function",
    name: "map_edit_geometry",
    description: "Activate geometry editing mode. Allows the user to modify existing shapes on the map.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  },
  {
    type: "function",
    name: "map_delete_geometry",
    description: "Activate geometry deletion mode. Allows the user to select and delete shapes.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  },

  // Geometry Operations (Triggered via Turf or UI states)
  {
    type: "function",
    name: "map_simplify_geometry",
    description: "Simplify the active geometry to reduce points.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  },
  {
    type: "function",
    name: "map_buffer_geometry",
    description: "CRITICAL: Always use this tool whenever the user mentions the word 'buffer' or asks to create/draw a buffer. Create a buffer around the currently selected geometry. If no geometry is selected, draw a default buffer (circle) at the center of the current map view. If the user provides a distance, use it; otherwise, default to 1.",
    parameters: {
      type: "object",
      properties: {
        distance: { type: "number", description: "Buffer distance in kilometers. Default is 1 if not provided by user." }
      },
      required: ["distance"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "map_split_polygon",
    description: "Activate polygon splitting mode.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  },
  {
    type: "function",
    name: "map_merge_polygons",
    description: "Merge selected polygons into one.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  }
];
