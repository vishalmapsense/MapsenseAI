import {
  LlmAgent,
  MCPToolset,
  FunctionTool,
  Gemini,
  TokenBasedContextCompactor,
  LlmSummarizer,
} from "@google/adk";
import { ALL_CLIENT_TOOLS } from "@/config/clientTools";
import { convertParametersToZod } from "./utils/zodMapper";
import { MAPBOX_MCP_CONFIG } from "@/config/mcp.config";
import {
  extractSpatialFromResponse,
  extractMetadata,
  createLightweightSummary,
  type SpatialDataBuffer,
  type InterceptedSpatialData,
} from "./utils/spatialDataInterceptor";
import {
  toolGuardrailCallback,
  permissionGrantCallback,
} from "./utils/toolGuardrail";

// Shared language constraint for all agents
const LANG_RULE =
  "IMPORTANT: You MUST communicate with the user in their preferred language. Prefer using Hinglish, Hindi, or English. If the user communicates in a specific local language, respond in that local language.";
const HITL_RULE =
  "HUMAN IN THE LOOP (HITL) & AMBIGUITY HANDLING:\n" +
  "- If the user prompt is ambiguous (e.g., multiple locations with the same name, missing region) OR if critical parameter data is missing, DO NOT guess. Instead, write a message directly in the chat asking the user for clarification.\n" +
  "- However, if you need EXPLICIT PERMISSION from the user before executing a major tool action, OR if a task involves fetching massive datasets/heavy computation that could cause performance issues, you MUST use the `request_user_permission` tool. This will pause execution and show a UI modal.\n" +
  "- Provide 2-4 concise options (e.g., ['Yes, proceed', 'No, cancel'] or ['Allow', 'Deny']) in the `request_user_permission` tool parameters.\n" +
  "- Do NOT use the `request_user_permission` tool for simple chat clarifications. ONLY use it when explicit consent/permission is required.";

const AGENT_SAFETY_STAND_RULE =
  "AGENT BOUNDARIES & SYSTEM SAFETY STAND:\n" +
  "- Even if the user explicitly demands, permits, or selects 'Yes' for actions that are absurdly heavy, unreasonable, system-crashing, or unsafe (e.g., executing 1000s of API calls, bulk dump requests, crashing server memory, batch scraping), YOU MUST TAKE A FIRM STAND AND REFUSE.\n" +
  "- User permission does NOT override platform rate limits, system stability rules, or operational safety.\n" +
  "- If a request exceeds practical safety boundaries (e.g. >250 items/calls), DO NOT run the tools even after permission. Respond directly with a polite, firm refusal explaining the system constraint and offer a practical, safe alternative (e.g. 'I cannot execute 1,000 API requests as it exceeds system safety limits and rate caps. I can fetch up to 50 sample items instead.').";

// ─── MapsenseAI Geospatial Skill Rules ─────────────────────────
// Extracted from SKILL.md — injected into runtime agent prompts
// so each agent knows its domain, boundaries, and anti-patterns.

const MAPBOX_AGENT_SKILL =
  "TOOL EXPERTISE — YOUR TOOLS FALL INTO 3 CATEGORIES:\n" +
  "\n" +
  "A) Search & Geocoding:\n" +
  "   - search_and_geocode_tool: Search places by name/address → coordinates.\n" +
  "   - reverse_geocode_tool: Convert lat/lng → place name.\n" +
  "   - category_search_tool: Find all places of a category near a location (restaurants, cafes, hospitals).\n" +
  "   - place_details_tool: Detailed info (photos, hours, rating) for a specific place.\n" +
  "   - ground_location_tool: Contextual info about a location — nearby POIs, neighborhood.\n" +
  "\n" +
  "B) Routing & Navigation (USE ONLY FOR REAL-ROAD QUERIES):\n" +
  "   - directions_tool: Driving/walking/cycling directions with route geometry. USE for 'how to go', 'driving distance', 'travel time'.\n" +
  "   - isochrone_tool: Areas reachable within X minutes by driving/walking/cycling.\n" +
  "   - matrix_tool: Travel time/distance matrix between multiple origins and destinations.\n" +
  "   - optimization_tool: Optimize stop order for shortest/fastest route (TSP).\n" +
  "\n" +
  "C) Offline Geometric / Measurement (Turf.js — NO road network):\n" +
  "   - distance_tool: Straight-line distance (Haversine). ONLY 'as the crow flies'.\n" +
  "   - length_tool, area_tool, bearing_tool, midpoint_tool: Pure math on coordinates.\n" +
  "   - buffer_tool, bbox_tool, centroid_tool, convex_tool, simplify_tool: Geometry operations on data.\n" +
  "   - intersect_tool, union_tool, difference_tool: Set operations on polygons.\n" +
  "   - nearest_point_tool, nearest_point_on_line_tool, points_within_polygon_tool, destination_tool.\n" +
  "\n" +
  "CRITICAL DECISION RULE — Routing vs Geometric:\n" +
  "   Q: Does the query involve ROADS, TRAVEL TIME, TRAFFIC, or DRIVING DISTANCE?\n" +
  "   → YES: Use directions_tool / matrix_tool / optimization_tool (Category B).\n" +
  "   → NO (just straight-line math, area, bearing): Use Category C tools.\n" +
  "   NEVER use distance_tool when user asks 'kitna time lagega' or 'driving distance'. Roads are NOT straight lines.\n" +
  "\n" +
  "ANTI-PATTERNS YOU MUST AVOID:\n" +
  "   ❌ NEVER guess or hardcode coordinates. Always geocode first with search_and_geocode_tool.\n" +
  "   ❌ If a tool returns Response_URL or mapbox://temp/... URI, return it AS-IS. Do NOT fetch/read it.\n" +
  "   ❌ NEVER use distance_tool for travel time/driving distance. Use directions_tool.\n" +
  "\n" +
  "DATA SIZE RULE: The server automatically extracts spatial/GeoJSON data from your tool responses " +
  "and sends it directly to the map. You will see a lightweight summary like '✅ 12 features extracted'. " +
  "Do NOT try to re-describe the geometry, re-render, or call map_add_geojson for data already extracted.";

const PLAYGROUND_AGENT_SKILL =
  "YOUR AVAILABLE TOOLS:\n" +
  "\n" +
  "1. get_zip_data — Fetch zip/postal boundary data.\n" +
  "   Keys: id, zipcode, officeName, division, region, circle.\n" +
  "   Optional fields: zipcode, officeName, division, region, circle, type, coordinates.\n" +
  "   You can fetch MULTIPLE zipcodes at once by passing a comma-separated string in the 'value' field.\n" +
  "   Example: get_zip_data(key='zipcode', value='208002, 208003, 110001')\n" +
  "\n" +
  "2. get_user_layers — Fetch user's saved layers.\n" +
  "   - No params = all layers. id = single layer. originalLayerId = all versions.\n" +
  "\n" +
  "3. get_osm_query — List all available OSM queries, or fetch one by queryId.\n" +
  "\n" +
  "4. run_osm_query — Execute a canned OSM query with queryId, parameters, amenities.\n" +
  "\n" +
  "5. run_duck_db_queries — Run DuckDB SQL. Params: queryText (required), saveAsJSON, fileNameJSON.\n" +
  "\n" +
  "SCOPE BOUNDARY: You handle ONLY platform data (zip, layers, OSM, DuckDB).\n" +
  "   ❌ NEVER handle geographic search (restaurants, routes, geocoding) — that is mapbox_agent's job.\n" +
  "\n" +
  "ANTI-PATTERNS YOU MUST AVOID:\n" +
  "   ❌ If a tool returns Response_URL, NEVER try to fetch, read, or DuckDB-query it. Return it verbatim.\n" +
  "   ❌ NEVER use run_duck_db_queries on a Response_URL from another tool. They are for the rendering pipeline.\n" +
  "\n" +
  "DATA SIZE RULE: The server automatically extracts spatial data from tool responses and sends it to the map. " +
  "You will see a lightweight summary. Do NOT try to re-fetch or re-render the data.\n" +
  "\n" +
  "BOUNDARY/REGION SEARCH RULE (CRITICAL for OSM amenity queries):\n" +
  "  When the user asks to search for amenities or features (schools, hospitals, ATMs, parks, etc.) but does NOT specify a region, boundary, or area:\n" +
  "  → You MUST ask the user: 'Kis region ya boundary ke ander search karna chahte hain? Please mention the region name (e.g., Delhi, Lucknow) or use the + icon in chat to Select Layer for an existing boundary on the map.'\n" +
  "  → Do NOT proceed with any tool call until the user provides a region/boundary.\n" +
  "\n" +
  "  When the user DOES specify a region name (e.g., 'schools in Delhi', 'ATMs in Lucknow'):\n" +
  "  → First fetch the boundary data using get_zip_data or get_district_data for that region.\n" +
  "  → Then use get_osm_query to find the right OSM query, and run_osm_query with the boundary coordinates as parameters.\n" +
  "\n" +
  "  When the message contains [ATTACHED_BOUNDARY_CONTEXT]:\n" +
  "  → Extract the polygon coordinates from the attached GeoJSON and use them directly as boundary parameters in run_osm_query.\n" +
  "  → Do NOT ask the user again — the boundary is already provided.";

const MAP_UI_AGENT_SKILL =
  "YOUR AVAILABLE TOOLS — 3 Categories:\n" +
  "\n" +
  "A) Navigation: map_fly_to(lat,lng,zoom), map_zoom_in, map_zoom_out, map_set_zoom, map_rotate, map_reset_rotation, map_fit_bounds.\n" +
  "B) Drawing & Markers: map_add_marker, map_remove_marker, map_move_marker, map_add_geojson, map_draw_point/line/polygon/circle/rectangle, map_edit_geometry, map_delete_geometry.\n" +
  "C) Layers & Style: map_clear_layers, map_toggle_layer, map_set_base(osm|carto-light|carto-dark|satellite), map_load_url.\n" +
  "D) Geometry Ops: map_simplify_geometry, map_buffer_geometry(distance_km), map_split_polygon, map_merge_polygons.\n" +
  "E) Layer Selection: map_select_layer — Activates layer selection mode. Use when the user wants to search/query WITHIN a specific boundary but hasn't provided one. The user can click on map features or layers panel items to select boundaries.\n" +
  "\n" +
  "CRITICAL RULES:\n" +
  "   - map_load_url is ONLY for user-provided HTTP/HTTPS URLs. NEVER use it for mapbox://temp/... or Response_URL (those auto-render).\n" +
  "   - map_add_geojson is for raw GeoJSON data you already have. NEVER fabricate GeoJSON.\n" +
  "   - map_buffer_geometry works ONLY on geometry already drawn on the map. For buffer around new coordinates, mapbox_agent uses buffer_tool.\n" +
  "   - After MCP tools return data, the system auto-renders it. You usually just need map_fit_bounds to adjust the camera.\n" +
  "   - Validate: lat must be -90 to 90, lng must be -180 to 180. Never guess coordinates.\n" +
  "\n" +
  "ANTI-PATTERNS YOU MUST AVOID:\n" +
  "   ❌ NEVER manually draw/add GeoJSON for data that MCP tools returned — system handles that automatically.\n" +
  "   ❌ NEVER use map_load_url for mapbox:// or Response_URL URIs.\n" +
  "   ❌ NEVER fabricate or hallucinate coordinates, GeoJSON, or routes.";

const PLANNER_AGENT_SKILL =
  "DECISION ALGORITHM — follow this for EVERY message:\n" +
  "\n" +
  "Step 1: CLASSIFY the request:\n" +
  "   Q1: Does it need GEOGRAPHIC data (places, routes, distances, isochrones, POIs, geocoding, spatial analysis)?\n" +
  "       → YES → mapbox_agent\n" +
  "   Q2: Does it need PLATFORM data (zip boundaries, user layers, OSM queries, DuckDB)?\n" +
  "       → YES → playground_agent\n" +
  "   Q2.5: Is the user providing a direct external link (like github.com, http, https) to a dataset or GeoJSON?\n" +
  "       → YES → map_ui_agent (using map_load_url)\n" +
  "   Q3: Does it need MAP DISPLAY action (zoom, fly, draw, markers, clear, base map, load URL)?\n" +
  "       → YES → map_ui_agent\n" +
  "   Q4: Does it need MULTIPLE steps (e.g., fetch data THEN display)?\n" +
  "       → YES → Sequential: data agent first → map_ui_agent → verifying_agent\n" +
  "\n" +
  "Step 2: After work agent returns → ALWAYS send to verifying_agent.\n" +
  "Step 3: If verifying_agent says INCOMPLETE → route to correct agent → verify again.\n" +
  "\n" +
  "SCENARIO EXAMPLES (memorize these patterns):\n" +
  "   'Delhi mein restaurants dikhao' → mapbox_agent(category_search) → map_ui_agent(fit_bounds) → verify\n" +
  "   'Delhi se Agra route' → mapbox_agent(geocode×2 + directions) → map_ui_agent(fit_bounds) → verify\n" +
  "   'Zip 208002 dikhao' → playground_agent(get_zip_data) → verify (auto-renders)\n" +
  "   '15 min driving reach' → mapbox_agent(isochrone) → map_ui_agent(fit_bounds) → verify\n" +
  "   'Meri layers dikhao' → playground_agent(get_user_layers) → verify\n" +
  "   'Ab zoom karo' (follow-up) → map_ui_agent(zoom_in) → verify\n" +
  "   '5 places best order' → mapbox_agent(optimization) → map_ui_agent(fit_bounds) → verify\n" +
  "   'Delhi 10km cafes' → mapbox_agent(geocode + category_search) → map_ui_agent(fit_bounds) → verify\n" +
  "   'Load https://github.com/.../india.geojson' → map_ui_agent(map_load_url) → verify\n" +
  "   'Find schools' (no region) → playground_agent asks user for region/boundary → STOP (HITL)\n" +
  "   'Schools in Delhi' → playground_agent(get_district_data for Delhi → get_osm_query → run_osm_query with boundary) → verify\n" +
  "   'ATMs dikhao' + [ATTACHED_BOUNDARY_CONTEXT] → playground_agent(get_osm_query → run_osm_query with attached polygon) → verify\n" +
  "\n" +
  "ANTI-PATTERNS — CRITICAL:\n" +
  "   ❌ NEVER reuse agent from previous turn. Every turn = FRESH classification.\n" +
  "   ❌ 'Find restaurants' is MAPBOX, not Playground. Playground is ONLY for zip/layers/OSM/DuckDB.\n" +
  "   ❌ NEVER write user-facing text yourself. Only verifying_agent does that.\n" +
  "   ❌ NEVER skip verifying_agent — it is MANDATORY after every work cycle.";

const VERIFYING_AGENT_SKILL =
  "VERIFICATION CHECKLIST — check ALL of these:\n" +
  "\n" +
  "1. Did the work agent use the CORRECT tool? (e.g., directions_tool for routes, NOT distance_tool)\n" +
  "2. Was Response_URL returned as-is (not fetched/queried by the agent)?\n" +
  "3. If map display was needed, did map_ui_agent execute it?\n" +
  "4. Were ALL parts of the user's request addressed? (e.g., user asked for BOTH search + zoom)\n" +
  "5. Were coordinates geocoded, not guessed?\n" +
  "\n" +
  "RESPONSE FORMAT RULES:\n" +
  "   - Multiple places found → Markdown TABLE with #, Name, Distance, Category.\n" +
  "   - Route/directions → Blockquote summary (distance, ETA, via). Inline code for road names.\n" +
  "   - Single location → Inline code for name+coords. Blockquote for full address.\n" +
  "   - Always end with ONE short, context-aware follow-up question.\n" +
  "   - NEVER generate tables from general knowledge. Only from actual tool results.";

export function createADKAgent(
  apiKey?: string,
  userPrompt?: string,
  spatialDataBuffer?: SpatialDataBuffer,
) {
  // Shared buffer for intercepted spatial data (route.ts reads this after runner completes)
  const _spatialBuffer: SpatialDataBuffer = spatialDataBuffer || [];
  // 1. Map all client tools to ADK FunctionTools
  const adkClientTools = ALL_CLIENT_TOOLS.map((clientTool) => {
    return new FunctionTool({
      name: clientTool.name,
      description: clientTool.description || "",
      parameters: clientTool.parameters
        ? convertParametersToZod(clientTool.parameters as any)
        : undefined,
      execute: (args: any) => {
        // Robustness: Validate coordinates before scheduling
        if (
          args.lat !== undefined &&
          (isNaN(args.lat) || args.lat < -90 || args.lat > 90)
        ) {
          throw new Error(
            `Invalid latitude: ${args.lat}. Must be between -90 and 90.`,
          );
        }
        if (
          args.lng !== undefined &&
          (isNaN(args.lng) || args.lng < -180 || args.lng > 180)
        ) {
          throw new Error(
            `Invalid longitude: ${args.lng}. Must be between -180 and 180.`,
          );
        }

        return {
          _type: "client_tool_call",
          name: clientTool.name,
          args: args,
          message: `Successfully scheduled ${clientTool.name} on the client map.`,
        };
      },
    });
  });

  const hitlTool = adkClientTools.find(
    (t) => t.name === "request_user_permission",
  )!;

  // 2. Set up the Mapbox MCP Toolset
  console.log(`[Mapbox MCP] Query: "${userPrompt || "none"}"`);
  console.log(`[Mapbox MCP] Loading ALL available Mapbox tools`);

  const mapboxMcpToolset = new MCPToolset({
    type: "StdioConnectionParams",
    serverParams: {
      command: "node",
      args: [
        process.env.MAPBOX_MCP_SCRIPT_PATH ||
          MAPBOX_MCP_CONFIG.serverScriptPath,
      ],
      env: {
        ...process.env,
        CLIENT_NEEDS_RESOURCE_FALLBACK: "true",
        MAPBOX_ACCESS_TOKEN:
          process.env.MAPBOX_SECRET_TOKEN || MAPBOX_MCP_CONFIG.accessToken,
        MAPBOX_SECRET_TOKEN:
          process.env.MAPBOX_SECRET_TOKEN || MAPBOX_MCP_CONFIG.accessToken,
      } as Record<string, string>,
    },
  });

  // 3. Set up the Playg MCP Toolset
  const playgMcpToolset = new MCPToolset({
    type: "StdioConnectionParams",
    serverParams: {
      command: "node",
      args: [
        "/Users/vishalkushwaha/Mapsense/MapsenseAI/playg-mcp-server/build/index.js",
      ],
      env: {
        ...process.env,
        PLAYG_API_BASE: "http://localhost:8000",
        USER_AGENT: "playg-mcp-server/1.0",
        REDIS_URL: "redis://localhost:6379",
        BEARER_TOKEN:
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImQ1ZGNlZmMxLWQ4ZjQtNDBmOC1iN2YxLWE2Mjc5YjhmNzkyNiIsImVtYWlsIjoiYWRtaW5AZW1haWwuY29tIiwib3JnYW5pemF0aW9uSWQiOiJmNmM2NjIzZS0xMWM3LTQzNTktOGJmMS05Zjg5YmQ4NjdjNWUiLCJvcmdhbml6YXRpb24iOiJQbGF0Zm9ybSBBZG1pbiIsInJvbGUiOiJTVVBFUl9BRE1JTiIsImlhdCI6MTc4NTcwNTg3N30.eSXBYQ-yAfPqdWVfNxS8Y8AR9uMA5VlGX3j_k0elnik",
        INSTANCE_PATH: "",
        FILE_PATH: "",
      } as Record<string, string>,
    },
  });

  const modelToUse = apiKey
    ? new Gemini({ model: "gemini-3.1-flash-lite", apiKey })
    : "gemini-3.1-flash-lite";

  // ─── Shared afterToolCallback: intercepts MCP spatial data ──────────
  const spatialInterceptCallback = async (params: {
    tool: any;
    args: Record<string, unknown>;
    context: any;
    response: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> => {
    const toolName = params.tool?.name || "unknown_tool";
    console.log(`🔬 [Spatial Interceptor] Checking tool response: ${toolName}`);

    try {
      const extracted = extractSpatialFromResponse(toolName, params.response);
      if (!extracted) {
        console.log(
          `  ↳ No spatial data found in ${toolName} response. Passing through.`,
        );
        return undefined; // Let original response go to LLM
      }

      let normalized = extracted.normalized;
      const rawParsed = extracted.rawParsed;

      // Handle async fetch cases (Response_URL, mapbox:// URI, HTTP URL)
      if (!normalized && rawParsed?._needsFetch && rawParsed?._responseUrl) {
        console.log(`  ↳ Fetching Response_URL: ${rawParsed._responseUrl}`);
        try {
          const fetchRes = await fetch(rawParsed._responseUrl);
          const jsonData = await fetchRes.json();
          const { normalizeToGeoJSON } =
            await import("@/utils/spatialNormalizer");
          normalized = normalizeToGeoJSON(jsonData, toolName);
        } catch (e) {
          console.error(`  ↳ Failed to fetch Response_URL:`, e);
          return undefined;
        }
      }

      if (!normalized && rawParsed?._needsFetch && rawParsed?._httpUrl) {
        console.log(`  ↳ Fetching HTTP URL: ${rawParsed._httpUrl}`);
        try {
          const { fetchAndNormalizeSpatialUrl } =
            await import("@/utils/spatialNormalizer");
          normalized = await fetchAndNormalizeSpatialUrl(
            rawParsed._httpUrl,
            toolName,
          );
        } catch (e) {
          console.error(`  ↳ Failed to fetch HTTP URL:`, e);
          return undefined;
        }
      }

      if (!normalized && rawParsed?._needsMcpResolve && rawParsed?._mapboxUri) {
        // MCP URI resolution needs the route-level resolver — store the URI for route to handle
        console.log(
          `  ↳ mapbox:// URI detected, storing for route-level resolution: ${rawParsed._mapboxUri}`,
        );
        _spatialBuffer.push({
          toolName,
          label: toolName,
          geojson: null, // Will be resolved by route
          metadata: {
            featureCount: 0,
            summary: `mapbox_uri:${rawParsed._mapboxUri}`,
          },
        });
        return {
          content: [
            {
              type: "text",
              text: `✅ Spatial data reference (${rawParsed._mapboxUri}) received. Data will be rendered on the map automatically. Do NOT call map_add_geojson or map_load_url.`,
            },
          ],
          _spatialDataExtracted: true,
        };
      }

      if (normalized?.features?.length > 0) {
        const metadata = extractMetadata(rawParsed, normalized.features.length);
        const summary = createLightweightSummary(toolName, metadata, rawParsed);

        console.log(
          `  ✅ Intercepted ${normalized.features.length} features from ${toolName}. LLM gets summary only.`,
        );

        // Store in shared buffer for route.ts to read
        _spatialBuffer.push({
          toolName,
          label: toolName,
          geojson: normalized,
          metadata,
        });

        // Return lightweight summary to LLM (replaces the full GeoJSON)
        return {
          content: [{ type: "text", text: summary }],
          _spatialDataExtracted: true,
        };
      }
    } catch (err) {
      console.error(`[Spatial Interceptor] Error processing ${toolName}:`, err);
    }

    return undefined; // Fallback: let original response go to LLM
  };

  // ─── Sub-Agent 1: Mapbox Agent (Mapbox MCP Tools) ───────────
  const mapboxAgent = new LlmAgent({
    model: modelToUse,
    name: "mapbox_agent",
    description:
      "Handles geocoding, place search, directions, isochrones, geometric computations, and all Mapbox spatial data.",
    instruction: `You are the Mapbox spatial data specialist. You search for places, geocode locations, compute geometry, and fetch spatial data using Mapbox MCP tools.

${MAPBOX_AGENT_SKILL}

AGENT BOUNDARY (CRITICAL — VIOLATION CAUSES SYSTEM CRASH):
- You do NOT have access to ANY map_* client tools (map_rotate, map_zoom_in, map_zoom_out, map_fly_to, map_fit_bounds, map_set_base, map_clear_layers, map_add_marker, map_add_geojson, map_load_url, map_draw_*, map_edit_*, map_delete_*, map_select_layer, etc.).
- You do NOT have access to playground tools (get_zip_data, get_osm_query, run_osm_query, run_duck_db_queries, get_user_layers).
- NEVER attempt to call tools you don't have. If the user's request needs map UI actions (zoom, rotate, fly, draw), complete YOUR data work and return your summary. The planner will route map UI tasks to map_ui_agent separately.
- If you accidentally try to call a tool you don't own, the system will crash with an error. This is YOUR fault — avoid it.

EXECUTION RULES:
- Execute the requested tool(s) and return a clear technical summary with all geographic data found.
- CRITICAL: If a tool returns a URI, URL, or data reference (e.g. Response_URL, mapbox://temp/...) for spatial data, DO NOT try to fetch, query, or read it yourself. Simply return the URL reference as it is to the parent.
- DO NOT generate a final user-facing response. DO NOT transfer to any other agent.
- When you are DONE, simply return your summary — control will automatically go back to your parent agent.
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
    tools: [mapboxMcpToolset, hitlTool],
    beforeToolCallback: toolGuardrailCallback,
    afterToolCallback: [spatialInterceptCallback, permissionGrantCallback],
  });

  // ─── Sub-Agent 2: Playground Agent (Playg MCP Tools) ───────────
  const playgroundAgent = new LlmAgent({
    model: modelToUse,
    name: "playground_agent",
    description:
      "Handles Playground platform data: zip boundary data, user layers, OSM queries, DuckDB analytics.",
    instruction: `You are the Playground/DTA platform data specialist. You fetch and manipulate platform-specific data.

${PLAYGROUND_AGENT_SKILL}

AGENT BOUNDARY (CRITICAL — VIOLATION CAUSES SYSTEM CRASH):
- You do NOT have access to ANY map_* client tools (map_rotate, map_zoom_in, map_zoom_out, map_fly_to, map_fit_bounds, map_set_base, map_clear_layers, map_add_marker, map_add_geojson, map_load_url, map_draw_*, map_edit_*, map_delete_*, map_select_layer, etc.).
- You do NOT have access to Mapbox MCP tools (search_and_geocode_tool, directions_tool, distance_tool, etc.).
- NEVER attempt to call tools you don't have. If the user's request needs map UI actions, complete YOUR data work and return your summary. The planner will route other tasks separately.
- If you accidentally try to call a tool you don't own, the system will crash with an error. This is YOUR fault — avoid it.

EXECUTION RULES:
- Execute the requested tool(s) and return a clear technical summary with all data found.
- CRITICAL: If a tool returns a URI, URL, or data reference (e.g. Response_URL), DO NOT try to fetch, query, or read it yourself (e.g., do not use DuckDB on it). Simply return the URL reference as it is to the parent.
- DO NOT generate a final user-facing response. DO NOT transfer to any other agent.
- When you are DONE, simply return your summary — control will automatically go back to your parent agent.
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
    tools: [playgMcpToolset, hitlTool],
    beforeToolCallback: toolGuardrailCallback,
    afterToolCallback: [spatialInterceptCallback, permissionGrantCallback],
  });

  // ─── Sub-Agent 3: Map UI Agent ────────────────────────────────
  const mapUiAgent = new LlmAgent({
    model: modelToUse,
    name: "map_ui_agent",
    description:
      "Executes map UI actions: fly_to, zoom, draw, markers, map_load_url, add_geojson, clear map, base map, geometry ops.",
    instruction: `You are the Map UI specialist. You execute map display actions using client-side tools.

${MAP_UI_AGENT_SKILL}

AGENT BOUNDARY (CRITICAL — VIOLATION CAUSES SYSTEM CRASH):
- You do NOT have access to Mapbox MCP tools (search_and_geocode_tool, directions_tool, distance_tool, category_search_tool, etc.).
- You do NOT have access to Playground tools (get_zip_data, get_osm_query, run_osm_query, run_duck_db_queries, get_user_layers).
- NEVER attempt to call tools you don't have. If you need spatial data or geocoded coordinates, return what's missing in your summary. The planner will route to the correct data agent.
- If you accidentally try to call a tool you don't own, the system will crash with an error. This is YOUR fault — avoid it.

EXECUTION RULES:
- You will receive coordinates, spatial data URLs, and context from the conversation history.
- Use the appropriate map tool with the correct arguments (lat, lng, zoom, url, etc.).
- If a previous agent provided a user-given HTTP URL to display, use 'map_load_url'. If it returned mapbox:// or Response_URL, DO NOT use map_load_url — the system auto-renders those.
- After your tool call succeeds, return a concise technical summary of the actions performed.
- DO NOT transfer to any other agent. DO NOT generate a final user-facing response.
- If a tool call fails, try again with corrected arguments (max 2 retries).
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
    tools: adkClientTools,
    beforeToolCallback: toolGuardrailCallback,
    afterToolCallback: permissionGrantCallback,
  });

  // ─── Sub-Agent 4: Verifying Agent ────────────────────────────────
  // Sits alongside work agents under planner. Has NO tools or sub-agents.
  // Its only job: check if work is complete and write final response.
  const verifyingAgent = new LlmAgent({
    model: modelToUse,
    name: "verifying_agent",
    description:
      "Checks if all parts of the user's request were completed. Writes the final user response if done, or reports what is still pending.",
    instruction: `You are the Verifying Agent. You are called by planner_agent AFTER work agents have finished.

${VERIFYING_AGENT_SKILL}

YOUR JOB:
1. Read the user's LATEST request from the conversation history.
2. Read the summaries returned by work agents (mapbox_agent, playground_agent, map_ui_agent).
3. Run through the VERIFICATION CHECKLIST above.
4. Check: were ALL parts of the user's request successfully completed?

ERROR DETECTION (CRITICAL — CHECK THIS FIRST):
- BEFORE reporting success, scan the ENTIRE conversation history for ANY of these error indicators:
  • Messages containing "UNKNOWN_ERROR", "Error", "error", "BLOCKED", "REJECTED"
  • Messages containing "is not found in the toolsDict" (means wrong agent was used)
  • Messages containing "EXECUTION BLOCKED" (means permission was needed but not granted)
  • Any functionResponse with an error field or error status
- If ANY error is found, you MUST mark the task as INCOMPLETE and specify:
  • Which tool/action failed
  • What the error was
  • Which agent should handle it instead
  Example: "INCOMPLETE: mapbox_agent tried to call map_rotate but it doesn't have that tool. Need map_ui_agent to handle map rotation."
  Example: "INCOMPLETE: Tool call failed with error 'Function map_ui_agent:map_rotate is not found'. The map rotation task was NOT completed. Need planner to route to map_ui_agent."
- NEVER report success when errors are present in the conversation. Even if SOME tasks succeeded, if ANY task has an error, report INCOMPLETE for the failed parts.

IF EVERYTHING IS COMPLETE (AND NO ERRORS DETECTED):
- Write a final, friendly, well-formatted response directly to the user summarizing what was done.
- Follow the RESPONSE FORMAT RULES above for proper formatting.
- You are the ONLY agent that should produce user-facing text.

IF SOMETHING IS MISSING OR FAILED:
- Return a technical message starting with "INCOMPLETE:" followed by exactly what is still pending.
  Example: "INCOMPLETE: Data was fetched but not displayed on the map. Need map_ui_agent to fly_to and add markers."
  Example: "INCOMPLETE: Search returned results but user also asked to zoom in. Need map_ui_agent to zoom."
  Example: "INCOMPLETE: Agent used distance_tool for driving distance. Need mapbox_agent to re-do with directions_tool."
  Example: "INCOMPLETE: mapbox_agent crashed trying to call map_rotate (wrong agent). Need map_ui_agent to rotate the map."
- Do NOT try to fix it yourself. Planner will read your message and route to the right agent.

DO NOT call any tools. DO NOT transfer to any agent. Just analyze and respond.
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
  });

  // ─── Sub-Agent 5: Planner Agent ────────────────────────────────
  // Main orchestrator: routes to correct work agent, then asks verifying to check.
  const plannerAgent = new LlmAgent({
    model: modelToUse,
    name: "planner_agent",
    description:
      "Routes queries to the correct agent using decision algorithm, then asks verifying_agent to confirm completion.",
    instruction: `You are the Planner — the main orchestrator of all map/data work.

${PLANNER_AGENT_SKILL}

HOW TO TRANSFER TO AGENTS (CRITICAL):
To route a task to another agent, you MUST call the tool matching their exact name (e.g. call the tool \`map_ui_agent\` to transfer to the Map UI agent). Do NOT try to call their internal tools directly.

STEP 1 — ROUTE TO THE RIGHT WORK AGENT:
Use the DECISION ALGORITHM above. Read the user's LATEST message and transfer to the correct agent using their specific transfer tool:
- 'mapbox_agent': Search places, geocoding, directions, isochrones, category search, distance, geometric ops — anything geographic/spatial.
- 'playground_agent': Zip boundary data, user layers, OSM queries, DuckDB analytics — anything platform/Playground.
- 'map_ui_agent': Fly to location, zoom, draw shapes, add markers, load GeoJSON/URLs, clear map, change base map, ROTATE, reset rotation — any map display action.

MAP UI TOOL ROUTING (MEMORIZE THIS):
These tools belong EXCLUSIVELY to map_ui_agent. NEVER route these to mapbox_agent or playground_agent:
→ map_rotate, map_reset_rotation, map_zoom_in, map_zoom_out, map_set_zoom, map_fly_to, map_fit_bounds
→ map_set_base, map_clear_layers, map_toggle_layer
→ map_add_marker, map_remove_marker, map_move_marker, map_add_geojson, map_load_url
→ map_draw_point, map_draw_line, map_draw_polygon, map_draw_circle, map_draw_rectangle
→ map_edit_geometry, map_delete_geometry, map_simplify_geometry, map_buffer_geometry
→ map_split_polygon, map_merge_polygons, map_select_layer

STEP 2 — VERIFY COMPLETION:
After the work agent returns its summary, ALWAYS transfer to 'verifying_agent' using the \`verifying_agent\` tool to check if the work is complete.

STEP 3 — HANDLE INCOMPLETE WORK:
If verifying_agent responds with "INCOMPLETE: ...", read what's missing and route to the correct work agent to fix it using their transfer tool. Then send back to verifying_agent again.
Repeat until verifying_agent confirms everything is done.

STEP 4 — ERROR RECOVERY (CRITICAL):
If a work agent returns an error like "Function X is not found in the toolsDict" or "UNKNOWN_ERROR", this means the task was sent to the WRONG agent. Do NOT give up. Immediately re-classify the failed tool and route to the CORRECT agent:
- Failed tool starts with map_* (map_rotate, map_zoom, map_fly_to, etc.) → Route to map_ui_agent
- Failed tool is an MCP tool (search_*, directions_*, distance_*, category_*) → Route to mapbox_agent
- Failed tool is a platform tool (get_zip_*, get_osm_*, run_duck_*, get_user_*) → Route to playground_agent
After re-routing, verify again with verifying_agent.
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
    tools: [hitlTool],
    beforeToolCallback: toolGuardrailCallback,
    afterToolCallback: permissionGrantCallback,
    subAgents: [mapboxAgent, playgroundAgent, mapUiAgent, verifyingAgent],
  });

  const rootAgent = new LlmAgent({
    model: modelToUse,
    name: "root_agent",
    description:
      "Main entry point — handles general chat or delegates map/data work to planner.",
    instruction: `You are Mapsense AI — a smart map assistant.

ROUTING — follow these rules for EVERY message:
1. GENERAL CHAT (greetings, "what can you do?", jokes, chitchat) → Answer directly yourself.
2. ANYTHING MAP/DATA RELATED → Transfer to 'planner_agent' IMMEDIATELY. Do not answer yourself.

Map/data includes: search, directions, zoom, draw, zip data, show on map, clear map, base map, and ALL follow-up requests like "ab isko map pe dikhao", "zoom in karo", "search another place", "clear karo".
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
    tools: [hitlTool],
    beforeToolCallback: toolGuardrailCallback,
    afterToolCallback: permissionGrantCallback,
    subAgents: [plannerAgent],
    contextCompactors: [
      new TokenBasedContextCompactor({
        tokenThreshold: 4000, // Trigger compaction when session exceeds 4000 tokens
        eventRetentionSize: 5, // Keep the 5 most recent raw events intact, drop older ones
        summarizer: new LlmSummarizer({ llm: modelToUse as any }),
      }),
    ],
  });

  return {
    rootAgent,
    mapboxMcpToolset,
    playgMcpToolset,
    spatialDataBuffer: _spatialBuffer,
  };
}
