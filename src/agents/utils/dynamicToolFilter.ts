import { GoogleGenAI } from "@google/genai";

/**
 * Lightweight tool catalog — AI reads these descriptions to pick the right tools.
 * Only name + short description are sent to the LLM (no full schemas),
 * keeping the selection prompt small and fast.
 */
export const MAPBOX_TOOL_CATALOG: { name: string; description: string }[] = [
  // ── Search & Geocoding ──
  { name: "search_and_geocode_tool", description: "Search for places by name/address and get coordinates. Use for any location search query." },
  { name: "reverse_geocode_tool", description: "Convert coordinates (lat/lng) to a place name or address." },
  { name: "category_search_tool", description: "Find all places of a category (restaurants, hotels, cafes, hospitals) near a location." },
  { name: "place_details_tool", description: "Get detailed info (photos, hours, rating, phone) for a specific place using its Mapbox ID." },
  { name: "ground_location_tool", description: "Answer what is near a location — nearby POIs, neighborhood context, and travel-time reachability." },

  // ── Routing & Navigation ──
  { name: "directions_tool", description: "Get driving/walking/cycling directions between two or more locations with distance, duration, and route geometry." },
  { name: "isochrone_tool", description: "Calculate reachability zones — areas reachable within X minutes by driving/walking/cycling." },
  { name: "matrix_tool", description: "Calculate travel time and distance matrix between multiple origins and destinations." },
  { name: "optimization_tool", description: "Optimize the order of multiple stops for the shortest/fastest route (TSP)." },

  // ── Measurement ──
  { name: "distance_tool", description: "Calculate straight-line distance between two coordinates (Haversine)." },
  { name: "length_tool", description: "Measure total length of a line/path defined by a series of coordinates." },
  { name: "area_tool", description: "Calculate the area of a polygon or multipolygon in sq meters, km, acres, etc." },
  { name: "bearing_tool", description: "Calculate compass bearing/direction from one point to another." },
  { name: "midpoint_tool", description: "Find the geographic midpoint between two coordinates." },

  // ── Geometry Operations ──
  { name: "buffer_tool", description: "Create a buffer zone (circle/polygon) around a point, line, or polygon at a given distance." },
  { name: "bbox_tool", description: "Calculate the bounding box (extent) of any geometry." },
  { name: "centroid_tool", description: "Calculate the geometric center (centroid) of a polygon." },
  { name: "convex_tool", description: "Compute the convex hull — smallest convex polygon that contains all given points." },
  { name: "simplify_tool", description: "Simplify a line or polygon by reducing vertices while preserving shape." },
  { name: "destination_tool", description: "Calculate a destination point given origin, bearing, and distance." },
  { name: "nearest_point_tool", description: "Find the nearest point in a collection to a target point." },
  { name: "nearest_point_on_line_tool", description: "Snap a point to the nearest position on a line/route." },
  { name: "points_within_polygon_tool", description: "Test which points fall inside a polygon boundary." },
  { name: "intersect_tool", description: "Find the overlapping area shared by two polygons." },
  { name: "union_tool", description: "Merge two or more polygons into a single unified geometry." },
  { name: "difference_tool", description: "Subtract one polygon from another — area in A not covered by B." },
];

/**
 * Build a compact tool list string for the LLM prompt.
 */
function buildCatalogPrompt(): string {
  return MAPBOX_TOOL_CATALOG.map(
    (t, i) => `${i + 1}. ${t.name} — ${t.description}`
  ).join("\n");
}

// All valid tool names for fast validation
const VALID_TOOL_NAMES = new Set(MAPBOX_TOOL_CATALOG.map((t) => t.name));

// Minimum tools that should always be available
const ALWAYS_INCLUDE = ["search_and_geocode_tool", "reverse_geocode_tool"];

/**
 * AI-powered tool selection: sends the tool catalog + user query to a
 * lightweight LLM and gets back only the relevant tool names.
 */
export async function getAISelectedTools(
  userPrompt: string,
  apiKey?: string
): Promise<string[]> {
  try {
    const ai = new GoogleGenAI({ apiKey });

    const systemPrompt = `You are a tool selector for a map AI assistant. Given a user query, select ONLY the tools needed from the catalog below.

TOOL CATALOG:
${buildCatalogPrompt()}

RULES:
- Return ONLY a JSON array of tool name strings, e.g. ["search_and_geocode_tool", "directions_tool"]
- Select the MINIMUM set of tools needed. Do NOT select all tools.
- Always include "search_and_geocode_tool" if the query involves finding/searching a place by name.
- Always include "reverse_geocode_tool" if coordinates are given and need to be converted to a place name.
- For simple conversational queries (hi, hello, how are you), return ["search_and_geocode_tool"].
- Output ONLY the JSON array, nothing else.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0,
      },
    });

    const text = response.text?.trim() || "";

    // Parse the JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed: string[] = JSON.parse(jsonMatch[0]);
      // Validate: only keep names that actually exist in our catalog
      const validated = parsed.filter((name) => VALID_TOOL_NAMES.has(name));
      // Ensure minimum tools are included
      for (const tool of ALWAYS_INCLUDE) {
        if (!validated.includes(tool)) {
          validated.push(tool);
        }
      }
      console.log(`🧠 [AI Tool Selector] Query: "${userPrompt.slice(0, 60)}..." → Selected ${validated.length} tools:`, validated);
      return validated;
    }

    console.warn("⚠️ [AI Tool Selector] Could not parse LLM response, falling back to defaults:", text);
    return [...ALWAYS_INCLUDE];
  } catch (err) {
    console.error("❌ [AI Tool Selector] LLM call failed, falling back to defaults:", err);
    return [...ALWAYS_INCLUDE];
  }
}

/**
 * Legacy keyword-based fallback (kept for reference / offline use).
 */
export const getDynamicTools = (prompt: string): string[] => {
  const p = prompt.toLowerCase();
  const tools = new Set<string>();
  
  tools.add("search_and_geocode_tool");
  tools.add("reverse_geocode_tool");

  if (p.includes("route") || p.includes("direction") || p.includes("path") || p.includes("drive") || p.includes("walk") || p.includes("navigate") || p.includes("traffic") || p.includes("how to go")) {
    tools.add("directions_tool");
    tools.add("matrix_tool");
    tools.add("optimization_tool");
  }
  if (p.includes("isochrone") || p.includes("reach") || p.includes("time") || p.includes("within") || p.includes("drive time") || p.includes("minutes")) {
    tools.add("isochrone_tool");
  }
  if (p.includes("category") || p.includes("restaurant") || p.includes("cafe") || p.includes("hotel") || p.includes("hospital") || p.includes("find") || p.includes("near") || p.includes("around") || p.includes("places")) {
    tools.add("category_search_tool");
    tools.add("ground_location_tool");
    tools.add("place_details_tool");
  }
  if (p.includes("buffer") || p.includes("radius")) {
    tools.add("buffer_tool");
  }
  if (p.includes("distance") || p.includes("far") || p.includes("length") || p.includes("measure")) {
    tools.add("distance_tool");
    tools.add("length_tool");
  }
  if (p.includes("area") || p.includes("size") || p.includes("square")) {
    tools.add("area_tool");
  }
  if (p.includes("intersect") || p.includes("overlap") || p.includes("difference") || p.includes("merge") || p.includes("union")) {
    tools.add("intersect_tool");
    tools.add("union_tool");
    tools.add("difference_tool");
  }
  if (p.includes("point") || p.includes("coordinate")) {
    tools.add("nearest_point_tool");
    tools.add("points_within_polygon_tool");
    tools.add("nearest_point_on_line_tool");
  }
  if (p.includes("midpoint") || p.includes("middle") || p.includes("halfway")) {
    tools.add("midpoint_tool");
  }
  if (p.includes("bearing") || p.includes("direction") || p.includes("compass") || p.includes("angle")) {
    tools.add("bearing_tool");
  }
  if (p.includes("destination") || p.includes("offset") || p.includes("travel")) {
    tools.add("destination_tool");
  }
  if (p.includes("simplify") || p.includes("reduce")) {
    tools.add("simplify_tool");
  }
  if (p.includes("convex") || p.includes("hull") || p.includes("envelope")) {
    tools.add("convex_tool");
  }
  if (p.includes("bbox") || p.includes("bounding box") || p.includes("extent") || p.includes("bounds")) {
    tools.add("bbox_tool");
  }
  if (p.includes("center") || p.includes("centroid")) {
    tools.add("centroid_tool");
  }

  return Array.from(tools);
};
