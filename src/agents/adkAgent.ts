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
  extractTabularFromResponse,
  createTabularSummary,
  type TabularDataBuffer,
  type TabularResultData,
} from "./utils/tabularDataInterceptor";
import { toolGuardrailCallback } from "./utils/toolGuardrail";

// Shared language constraint for all agents
const LANG_RULE =
  "IMPORTANT: You MUST communicate with the user in their preferred language. Prefer using Hinglish, Hindi, or English. If the user communicates in a specific local language, respond in that local language.";
const HITL_RULE =
  "HUMAN IN THE LOOP (HITL), AMBIGUITY & SUGGESTION HANDLING:\n" +
  "- If the user prompt is ambiguous (e.g., multiple locations with the same name, missing region, unclear destination) OR if critical parameter data is missing, DO NOT guess.\n" +
  "- AMBIGUITY & MULTIPLE CHOICES (MANDATORY): When geocoding or searching returns multiple matching locations, places, or options, OR when asking the user to clarify/choose between options:\n" +
  "  1. ALWAYS list the top 2-5 candidate options directly in your message with their full context (e.g. City, State, Country, or distinguishing detail).\n" +
  "  2. ALWAYS provide interactive suggestion chips using the tag `[OPTION: <option text>]` for each choice at the end of your message. Example:\n" +
  '     \'Multiple locations found for "Houser". Please choose your intended place:\n' +
  "     1. Hosur, Tamil Nadu, India\n" +
  "     2. Houser, Idaho, United States\n" +
  "     3. Houser, Washington, United States\n\n" +
  "     [OPTION: Hosur, Tamil Nadu, India]\n" +
  "     [OPTION: Houser, Idaho, United States]\n" +
  "     [OPTION: Houser, Washington, United States]'\n" +
  "  The chat UI automatically converts each `[OPTION: ...]` tag into an interactive, clickable chip button that the user can click to instantly re-send that choice!\n" +
  "  3. NEVER ask the user to clarify or say 'there are multiple locations' without listing the candidate options and including `[OPTION: ...]` chips!\n" +
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
  "   ❌ NEVER call render_map_tool or attempt to render maps. You are a DATA specialist only. All map display and UI actions are handled automatically by the system or by map_ui_agent.\n" +
  "   - When search_and_geocode_tool returns multiple matching locations for an ambiguous query, return ALL candidate place names with their state/country in your summary so verifying_agent can prompt the user with interactive choice chips.\n" +
  "\n" +
  "DATA SIZE RULE: The server automatically extracts spatial/GeoJSON data from your tool responses " +
  "and sends it directly to the map. You will see a lightweight summary like '✅ 12 features extracted'. " +
  "Do NOT try to re-describe the geometry, re-render, or call map_add_geojson or render_map_tool for data already extracted.";

const PLAYGROUND_AGENT_SKILL =
  "YOUR AVAILABLE TOOLS:\n" +
  "\n" +
  "1. get_zip_data — Fetch zip/postal boundary data.\n" +
  "   Keys: id, zipcode, officeName, division, region, circle.\n" +
  "   Optional fields: zipcode, officeName, division, region, circle, type, coordinates.\n" +
  "   You can fetch MULTIPLE zipcodes at once by passing a comma-separated string in the 'value' field.\n" +
  "   Example: get_zip_data(key='zipcode', value='208002,208003,110001') (IMPORTANT: Do NOT add spaces after commas).\n" +
  "\n" +
  "2. get_district_data — Fetch district boundary data.\n" +
  "   You can fetch MULTIPLE districts at once by passing a comma-separated string in the 'dtname' field.\n" +
  "   Example: get_district_data(dtname='Delhi,Lucknow,Kanpur') (IMPORTANT: Do NOT add spaces after commas).\n" +
  "\n" +
  "3. get_user_layers — Fetch user's saved layers.\n" +
  "   - No params = all layers. id = single layer. originalLayerId = all versions.\n" +
  "\n" +
  "4. get_osm_query — List all available OSM queries, or fetch one by queryId.\n" +
  "\n" +
  "5. run_osm_query — Execute a canned OSM query with queryId, parameters, amenities.\n" +
  "\n" +
  "SCOPE BOUNDARY: You handle ONLY platform boundary data (zip, district, user layers, OSM queries).\n" +
  "   ❌ NEVER handle geographic search (restaurants, routes, geocoding) — that is mapbox_agent's job.\n" +
  "   ❌ NEVER handle SQL queries, DuckDB analytics, or layer calculations (area, counts, statistics) — that is duckdb_agent's job. If the request contains [SELECTED_MAP_LAYERS] or [MAP_SQL_CONTEXT] or asks for SQL/area analysis, do NOT use tools and return: 'Transferring to duckdb_agent for SQL analysis.'\n" +
  "\n" +
  "ANTI-PATTERNS YOU MUST AVOID:\n" +
  "   ❌ If a tool returns Response_URL, NEVER try to fetch, read, or DuckDB-query it. Return it verbatim.\n" +
  "   ❌ NEVER try to execute SQL queries on map layers or boundary data. That belongs to duckdb_agent.\n" +
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

const DUCKDB_AGENT_SKILL =
  "MAP LAYERS & [SELECTED_MAP_LAYERS] (CRITICAL — ALWAYS FOLLOW):\n" +
  "- When the user asks to query or analyze map layers (or message contains [SELECTED_MAP_LAYERS] or [MAP_SQL_CONTEXT]):\n" +
  '  1. The target table (e.g. "nyc_census_population_data", "nawabganj_ho", "layer_1", "map_features") is ALREADY LOADED in client-side DuckDB-Wasm in the browser.\n' +
  "  2. You MUST use 'run_client_duckdb_query'.\n" +
  "  3. ❌ NEVER call backend 'run_duck_db_queries' for client map layers because they do not exist on the backend database.\n" +
  "  4. ❌ NEVER say the table does not exist and NEVER apologize or ask if you should re-fetch boundary data. The data is already loaded in the client-side table!\n" +
  "  5. PRE-COMPUTED COLUMNS AVAILABLE ON EVERY LAYER (POLYGONS, LINES, POINTS):\n" +
  "     - Centroid & Coordinates: 'center_lat', 'center_lng', 'lat', 'lng', 'centroid' (WKT 'POINT(lng lat)')\n" +
  "     - Area & Measurements: 'area_sq_km', 'area_sq_meters', 'perimeter_km'\n" +
  "     - In master table 'map_features': column '__layer_name' matches the sanitized table name (e.g. 'nyc_census_population_data')\n" +
  "  6. FOR CENTROID QUERIES (e.g. 'centroid find karo', 'center of features', 'find centroids'):\n" +
  "     Execute:\n" +
  '       SELECT <attr_col>, center_lat, center_lng, centroid FROM "<tableName>";\n' +
  "     (or: SELECT <attr_col>, center_lat, center_lng, centroid FROM map_features WHERE __layer_name = '<tableName>';)\n" +
  "     ❌ NEVER call ST_Centroid() or ST_GeomFromGeoJSON() — use pre-computed columns: center_lat, center_lng, centroid!\n" +
  "  7. FOR AREA QUERIES (e.g. 'area batao', 'area kitna hai', 'find area'):\n" +
  "     Execute:\n" +
  '       SELECT <attr_col>, area_sq_km, area_sq_meters FROM "<tableName>";\n' +
  "  8. The query results will appear directly in the user's Query Results Panel. Provide a concise 1-2 sentence summary of the result in your answer.\n\n" +
  "CRITICAL LAYER STYLING RULE (NEVER RUN SQL FOR COLORING):\n" +
  "- When the user asks to COLOR, STYLE, HIGHLIGHT, or CATEGORIZE a layer or its features (e.g. 'color karo', 'region ke basis par color', 'color code by speed', 'sab features ko red kardo'):\n" +
  "  1. ❌ DO NOT run a SQL SELECT query (e.g., SELECT ... FROM ... LIMIT 50 or GROUP BY) that dumps filtered rows into the Query Results table! The user wants to view ALL the data on the map styled with colors, not a filtered subset in a table.\n" +
  "  2. ✅ Call 'map_style_layer' directly!\n" +
  "     * Discrete category example: map_style_layer(layerIndex=0, style={ type: 'category', field: 'region' })\n" +
  "     * Continuous numeric into Best/Average/Poor: map_style_layer(layerIndex=0, style={ type: 'category', field: 'network_category', sourceField: 'avg_d_kbps', ranges: [...] })\n" +
  "     * Gradient example: map_style_layer(layerIndex=0, style={ type: 'gradient', field: 'avg_d_kbps', min: 0, max: 50000 })\n" +
  "  3. Calling 'map_style_layer' styles ALL features across the layer instantly on the map.\n\n" +
  "YOUR AVAILABLE TOOLS:\n" +
  "\n" +
  "1. run_client_duckdb_query — Execute fast DuckDB SQL directly in the browser (client DuckDB-Wasm).\n" +
  "   Required param: queryText (the SQL query string).\n" +
  "   Optional param: description (string).\n" +
  "   WHEN TO USE:\n" +
  "   - Queries on layers/features already loaded or visible on the map.\n" +
  "   - In-memory tables available: 'map_features' (all active features), 'layers' (layer metadata), or specific layer names.\n" +
  "   - Both simple aggregations (SUM, AVG, MIN, MAX) and HEAVY/COMPLEX spatial analysis (e.g. ST_Intersection) if intended by the user to run locally.\n" +
  "   - Fast, zero-server latency execution via WASM.\n" +
  "\n" +
  "2. run_duck_db_queries — Execute heavy DuckDB SQL on the backend server.\n" +
  "   Required param: queryText (the SQL query string).\n" +
  "   Optional params: saveAsJSON (boolean), fileNameJSON (string).\n" +
  "   WHEN TO USE (COMPLEX ANALYSIS & HEAVY DATASETS):\n" +
  "   - Massive remote Parquet/CSV files, large external URLs requiring backend fetch/compute.\n" +
  "   - Complex multi-dataset spatial joins (e.g., ST_Intersects on large external shapefiles).\n" +
  "   - Database tables stored in backend instance.\n" +
  "\n" +
  "ROUTING HEURISTIC:\n" +
  "   - By default, use run_client_duckdb_query for data ALREADY ON THE MAP or any analysis the user wants to run in the browser.\n" +
  "   - You are ALLOWED to run HEAVY and COMPLEX spatial queries using run_client_duckdb_query if it aligns with the user's intent (e.g., they explicitly ask to run it on the client, or are querying map layers). The client-side DuckDB-Wasm can handle it.\n" +
  "   - Only USE run_duck_db_queries for heavy external file analysis if it specifically requires backend-only resources or if the user explicitly requests server-side compute.\n" +
  "\n" +
  "NEW DATASET / UNFAMILIAR URL WORKFLOW (MANDATORY):\n" +
  "   - When given a new dataset URL or file whose exact schema/columns you do not know with 100% certainty:\n" +
  "     Step 1: ALWAYS run DESCRIBE first to inspect the schema:\n" +
  "       INSTALL spatial; LOAD spatial; DESCRIBE SELECT * FROM st_read('URL');\n" +
  "     Step 2: Read the returned schema list carefully. Note exact column names, casing, and types.\n" +
  "     Step 3: Execute your analytical query using the exact column names discovered in Step 1.\n" +
  "   - ❌ NEVER guess column names without checking the schema (e.g. guessing 'total_population' instead of 'Population').\n" +
  "   - ❌ NEVER claim a column is missing without checking the full DESCRIBE output.\n" +
  "\n" +
  "COLUMN CASING & QUOTING (CRITICAL):\n" +
  '   - DuckDB is case-sensitive for quoted identifiers. Datasets from JSON/GeoJSON/Parquet often use Capitalized or mixed-case column names (e.g., "Population", "OGC_FID").\n' +
  '   - ALWAYS double-quote column names that have uppercase letters: e.g. "Population", "OGC_FID".\n' +
  '   - If DuckDB returns: \'Referenced column X not found in FROM clause! Candidate bindings: "Population"\', IMMEDIATELY use the candidate binding in double quotes: "Population"!\n' +
  "\n" +
  "SPATIAL EXTENSION — always load when doing spatial work:\n" +
  "   INSTALL spatial; LOAD spatial;\n" +
  "   Then use functions like ST_Read(), ST_Point(), ST_Intersects(), ST_Area(), ST_Buffer(), ST_Distance(), etc.\n" +
  "\n" +
  "READING DATA — DuckDB can read directly from URLs and local files:\n" +
  "   - Parquet: SELECT * FROM read_parquet('https://example.com/data.parquet');\n" +
  "   - CSV: SELECT * FROM read_csv('https://example.com/data.csv', AUTO_DETECT=TRUE);\n" +
  "   - GeoJSON: SELECT * FROM st_read('https://example.com/data.geojson');\n" +
  "   - Shapefile: SELECT * FROM st_read('/path/to/file.shp');\n" +
  "   - Existing table: SELECT * FROM rides;\n" +
  "\n" +
  "GEOMETRY OUTPUT FORMAT (CRITICAL — ALWAYS FOLLOW!):\n" +
  "   - ❌ NEVER return raw/binary geometry columns (WKB/WKT). They CANNOT be displayed on the map.\n" +
  "   - ✅ ALWAYS convert geometry to GeoJSON using ST_AsGeoJSON().\n" +
  "   - ❌ WRONG: SELECT * FROM my_data; (returns raw binary geom)\n" +
  "   - ❌ WRONG: SELECT *, ST_AsGeoJSON(geom) AS geom FROM my_data; (duplicates the column, breaks the map)\n" +
  "   - ✅ CORRECT: SELECT * EXCLUDE (geom), ST_AsGeoJSON(geom) AS geom FROM my_data;\n" +
  "   - Top-N boundary example:\n" +
  "     INSTALL spatial; LOAD spatial;\n" +
  "     SELECT * EXCLUDE (geom), ST_AsGeoJSON(geom) AS geom FROM st_read('URL') ORDER BY \"Population\" DESC LIMIT 50;\n" +
  "   - This rule applies to EVERY query that reads from a table/file containing a geometry column (geom, geometry, wkb_geometry, the_geom, shape).\n" +
  "   - Returning ST_AsGeoJSON(geom) AS geom causes the boundaries to automatically render on the map for the user!\n" +
  "\n" +
  "SQL BEST PRACTICES:\n" +
  "   - For exploration queries, always use LIMIT (e.g., LIMIT 100) to avoid huge results.\n" +
  "   - For analytics, prefer aggregations (COUNT, SUM, AVG, GROUP BY, ORDER BY).\n" +
  '   - For top-N queries: ORDER BY "column" DESC LIMIT N.\n' +
  "   - Write standard SQL — DuckDB supports PostgreSQL-compatible syntax.\n" +
  "   - Multiple statements in one queryText are OK (separate with semicolons).\n" +
  "   - Always start spatial queries with: INSTALL spatial; LOAD spatial;\n" +
  "\n" +
  "INTENT UNDERSTANDING:\n" +
  "   - Understand user requests in Hindi, Hinglish, or English.\n" +
  "   - Translate natural language intent to precise SQL.\n" +
  "   - Examples: 'kitni rides hain?' → SELECT COUNT(*) FROM rides;\n" +
  "              'sabse lambi trip dikhao' → SELECT * FROM rides ORDER BY trip_distance DESC LIMIT 10;\n" +
  "              'har vendor ki total earning' → SELECT vendor_id, SUM(total_amount) FROM rides GROUP BY vendor_id;\n" +
  "              'Give top 50 boundry by population' → SELECT * EXCLUDE (geom), ST_AsGeoJSON(geom) AS geom FROM st_read('URL') ORDER BY \"Population\" DESC LIMIT 50;\n" +
  "\n" +
  "SCOPE BOUNDARY: You handle ONLY DuckDB SQL analytics on data files/URLs/tables.\n" +
  "   ❌ NEVER handle geographic search (restaurants, routes, geocoding) — that is mapbox_agent's job.\n" +
  "   ❌ NEVER handle zip data, OSM queries, user layers — that is playground_agent's job.\n" +
  "\n" +
  "DATA SIZE RULE: The server automatically intercepts your query results and sends them " +
  "directly to the client's Query Results Panel and renders spatial features on the map. " +
  "You will see a lightweight summary. " +
  "Do NOT try to reproduce or list all the data rows in your response. Just summarize the analytical insight.";

const MAP_UI_AGENT_SKILL =
  "YOUR AVAILABLE TOOLS — 6 Categories:\n" +
  "\n" +
  "A) Navigation: map_fly_to(lat,lng,zoom), map_zoom_in, map_zoom_out, map_set_zoom, map_rotate, map_reset_rotation, map_fit_bounds.\n" +
  "B) Drawing & Markers: map_add_marker, map_remove_marker, map_move_marker, map_add_geojson, map_draw_point/line/polygon/circle/rectangle, map_edit_geometry, map_delete_geometry.\n" +
  "C) Layers & Style: map_clear_layers, map_toggle_layer, map_set_base(osm|carto-light|carto-dark|satellite), map_load_url.\n" +
  "D) Geometry Ops: map_simplify_geometry, map_buffer_geometry(distance_km), map_split_polygon, map_merge_polygons.\n" +
  "E) Layer Selection: map_select_layer — Activates layer selection mode. Use when the user wants to search/query WITHIN a specific boundary but hasn't provided one. The user can click on map features or layers panel items to select boundaries.\n" +
  "F) Layer Styling: map_style_layer, map_clear_layer_style — Apply or remove data-driven visual styling to map layers.\n" +
  "   Supports 3 style types:\n" +
  "   - 'category': Color features by discrete category OR numeric thresholds.\n" +
  "     * SIMPLEST & MOST POWERFUL: You only need to provide 'field' and optionally 'palette'! The system automatically discovers all unique categories and assigns distinct, harmonious colors without single-color fallback!\n" +
  "       Example: map_style_layer(layerIndex=0, style={ type: 'category', field: 'region', palette: 'rainbow' })\n" +
  "       Palettes available: 'rainbow' (default multi-hue), 'traffic' (green/yellow/red), 'ocean' (blues/teals), 'heatmap' (yellow to red), 'viridis' (blue to yellow), 'sunset' (purple to orange), 'pastel'.\n" +
  "     * Custom mapping example:\n" +
  "       map_style_layer(layerIndex=0, style={ type: 'category', field: 'status', mapping: { 'Active': { fillColor: [34,197,94,180], label: 'Active' }, 'Inactive': { fillColor: [239,68,68,180], label: 'Inactive' } } })\n" +
  "     * Continuous numeric classified into classes (e.g. speed, score, rating into Best/Average/Poor):\n" +
  "       map_style_layer(layerIndex=0, style={\n" +
  "         type: 'category',\n" +
  "         field: 'network_category',\n" +
  "         sourceField: 'avg_d_kbps',\n" +
  "         ranges: [\n" +
  "           { min: 25000, category: 'Best' },\n" +
  "           { min: 10000, max: 25000, category: 'Average' },\n" +
  "           { max: 10000, category: 'Poor' }\n" +
  "         ],\n" +
  "         mapping: {\n" +
  "           'Best': { fillColor: [34,197,94,180], label: 'Best (>= 25 Mbps)' },\n" +
  "           'Average': { fillColor: [234,179,8,180], label: 'Average (10-25 Mbps)' },\n" +
  "           'Poor': { fillColor: [239,68,68,180], label: 'Poor (< 10 Mbps)' }\n" +
  "         }\n" +
  "       })\n" +
  "   - 'gradient': Color features by numeric range. If min/max are omitted, they are auto-calculated from the data!\n" +
  "     Example: map_style_layer(layerIndex=0, style={ type: 'gradient', field: 'avg_d_kbps', minColor: [239,68,68,180], maxColor: [34,197,94,180] })\n" +
  "   - 'solid': Apply a flat single color to the entire layer.\n" +
  "     Example: map_style_layer(layerIndex=0, style={ type: 'solid', fillColor: [34,197,94,180] })\n" +
  "   - Dynamic Point Sizing / Bubbles:\n" +
  "     Add 'sizeField' (e.g. 'population') or 'pointRadius' (e.g. 8) to scale circle sizes on point layers.\n" +
  "   COLOR REFERENCE (RGBA, use alpha 180 for fill, 255 for lines):\n" +
  "     Green=[34,197,94], Yellow=[234,179,8], Red=[239,68,68], Blue=[59,130,246],\n" +
  "     Orange=[249,115,22], Purple=[168,85,247], Teal=[20,184,166], Pink=[236,72,153],\n" +
  "     Cyan=[6,182,212], Indigo=[99,102,241], Lime=[132,204,22], Amber=[245,158,11]\n" +
  "   Use map_clear_layer_style(layerIndex) to remove styling and revert to default.\n" +
  "\n" +
  "STYLING WORKFLOW — FULLY FLEXIBLE FOR ANY USER INTENT (CRITICAL):\n" +
  "   When a user asks to categorize, color-code, highlight, or classify features on a layer (e.g. 'south and north ke basis par color karo', 'color by status', 'filter karke color karo'):\n" +
  "   1. Direct Categorical Field: { type: 'category', field: '<fieldName>', palette: 'rainbow' } (auto-discovers unique values).\n" +
  "   2. VALUE GROUPS (for queries like 'South aur North ke basis par color karo'):\n" +
  "      Use 'valueGroups' to group features into concepts (e.g. South vs North, Metro vs Rural):\n" +
  "      map_style_layer(layerIndex=0, style={\n" +
  "        type: 'category',\n" +
  "        field: 'region',\n" +
  "        valueGroups: {\n" +
  "          'South': ['Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Telangana', 'Goa', 'Puducherry'],\n" +
  "          'North': ['Delhi', 'Punjab', 'Haryana', 'Uttar Pradesh', 'Himachal Pradesh', 'Jammu & Kashmir', 'Rajasthan', 'Uttarakhand', 'Ladakh']\n" +
  "        },\n" +
  "        mapping: {\n" +
  "          'South': { fillColor: [59, 130, 246, 200] },\n" +
  "          'North': { fillColor: [239, 68, 68, 200] }\n" +
  "        }\n" +
  "      })\n" +
  "      The engine maps features matching these values and tags them with the category!\n" +
  "   3. RULES: For conditions or comparisons (e.g. lat < 20, rating > 4):\n" +
  "      map_style_layer(layerIndex=0, style={ type: 'category', rules: [ { category: 'South', condition: 'lat < 20' }, { category: 'North', condition: 'lat >= 20' } ] })\n" +
  "   4. FILTER + COLOR: Set dimUnmatched: true (dims other features to faint gray) or hideUnmatched: true (hides others).\n" +
  "   5. RANGES: For continuous numeric thresholds (Best/Average/Poor), use 'ranges'.\n" +
  "   6. DUCKDB FILTERING: If the user asks to filter data via SQL, call run_client_duckdb_query with applyToMap: true to display filtered features on the map, then style with map_style_layer.\n" +
  "\n" +
  "CRITICAL RULES:\n" +
  "   - map_load_url is for user-provided HTTP/HTTPS URLs AND local file paths from [ATTACHED_LOCAL_FILES].\n" +
  "     NEVER use it for mapbox://temp/... or Response_URL (those auto-render).\n" +
  "   - ATTACHED LOCAL FILES RULE (CRITICAL):\n" +
  "     When the user attaches local files ([ATTACHED_LOCAL_FILES]), you MUST extract ALL file paths listed.\n" +
  "     If there are multiple files (e.g. 2 files), call `map_load_url` for EACH file separately!\n" +
  "     Example with 2 files:\n" +
  "       1. map_load_url(url='/path/to/file1.geojson', label='file1')\n" +
  "       2. map_load_url(url='/path/to/file2.geojson', label='file2')\n" +
  "       3. map_fit_bounds()\n" +
  "     Never skip any attached file! Always load all of them onto the map.\n" +
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
  "   Q0 (COLOR, STYLE, & VISUAL CATEGORIZATION): Does the user want to COLOR, STYLE, HIGHLIGHT, CLASSIFY, or VISUALLY CATEGORIZE map features or layers?\n" +
  '       (Keywords: "color karo", "color code", "rang bharo", "style karo", "south aur north color karo", "region ke basis par color", "speed ke hisab se color", "classify into classes", "sab features ko color karo", "sabko red kardo", "gradient lagao", "styling hata do", "reset style", "apply color", "filter karke color karo")\n' +
  "       → Usually map_ui_agent with map_style_layer (using valueGroups, rules, or direct mapping)!\n" +
  "       → If the user specifically asks to query/filter data with SQL first before coloring, duckdb_agent can run run_client_duckdb_query (pass applyToMap: true if user wants filtered layer on map), followed by map_style_layer.\n" +
  "   Q1: Does the message contain [SELECTED_MAP_LAYERS] or [MAP_SQL_CONTEXT], or does the user want SQL analytics / queries / area / counts / statistics on map layers or datasets?\n" +
  "       → ALWAYS duckdb_agent! (NEVER playground_agent, NEVER mapbox_agent). duckdb_agent executes run_client_duckdb_query directly in the user's browser.\n" +
  "   Q2: Does it need GEOGRAPHIC data (places, routes, distances, isochrones, POIs, geocoding, spatial analysis)?\n" +
  "       → YES → mapbox_agent\n" +
  "   Q3: Does it need PLATFORM data (zip boundaries, user layers, OSM queries)?\n" +
  "       → YES → playground_agent\n" +
  "   Q4: Does user want to ANALYZE/QUERY a dataset, file, CSV, Parquet, or GeoJSON using DuckDB/SQL, or query map layers?\n" +
  "       → YES → duckdb_agent (duckdb_agent will automatically select run_client_duckdb_query for small/normal queries or run_duck_db_queries for heavy backend analysis)\n" +
  "   Q5: Is the user providing a direct external link (like github.com, http, https) or [ATTACHED_LOCAL_FILES] for DISPLAY/LOADING (not SQL analysis)?\n" +
  "       → YES → map_ui_agent (using map_load_url for EACH file/URL)\n" +
  "   Q6: Does it need MAP DISPLAY action (zoom, fly, draw, markers, clear, base map, load URL)?\n" +
  "       → YES → map_ui_agent\n" +
  "   Q7: Does it need MULTIPLE steps (e.g., fetch data THEN display)?\n" +
  "       → YES → Sequential: data agent first → map_ui_agent → verifying_agent\n" +
  "\n" +
  "Step 2: After work agent returns → ALWAYS send to verifying_agent.\n" +
  "Step 3: If verifying_agent says INCOMPLETE → route to correct agent → verify again.\n" +
  "\n" +
  "SCENARIO EXAMPLES (memorize these patterns):\n" +
  "   'south and north ke basis par color karo' → map_ui_agent(map_style_layer with valueGroups={'South': [...], 'North': [...]}) → verify\n" +
  "   'india ookla ka data ko region ke basis par color karo' + [SELECTED_MAP_LAYERS] → map_ui_agent(map_style_layer with type='category', field='region') → verify\n" +
  "   'region ke basis par color kardo' → map_ui_agent(map_style_layer with type='category', field='region') → verify\n" +
  "   'area batao' + [SELECTED_MAP_LAYERS] → duckdb_agent(run_client_duckdb_query) → verify\n" +
  "   'Nawabganj ka area kitna hai' → duckdb_agent(run_client_duckdb_query) → verify\n" +
  "   'Delhi mein restaurants dikhao' → mapbox_agent(category_search) → map_ui_agent(fit_bounds) → verify\n" +
  "   'Delhi se Agra route' → mapbox_agent(geocode×2 + directions) → map_ui_agent(fit_bounds) → verify\n" +
  "   'Zip 208002 dikhao' → playground_agent(get_zip_data) → verify (auto-renders)\n" +
  "   '15 min driving reach' → mapbox_agent(isochrone) → map_ui_agent(fit_bounds) → verify\n" +
  "   'Meri layers dikhao' → playground_agent(get_user_layers) → verify\n" +
  "   'Ab zoom karo' (follow-up) → map_ui_agent(zoom_in) → verify\n" +
  "   '5 places best order' → mapbox_agent(optimization) → map_ui_agent(fit_bounds) → verify\n" +
  "   'Delhi 10km cafes' → mapbox_agent(geocode + category_search) → map_ui_agent(fit_bounds) → verify\n" +
  "   'Load https://github.com/.../india.geojson' → map_ui_agent(map_load_url) → verify\n" +
  "   'load this data' + [ATTACHED_LOCAL_FILES] → map_ui_agent(map_load_url for each attached file + map_fit_bounds) → verify\n" +
  "   'Find schools' (no region) → playground_agent asks user for region/boundary → STOP (HITL)\n" +
  "   'Schools in Delhi' → playground_agent(get_district_data for Delhi → get_osm_query → run_osm_query with boundary) → verify\n" +
  "   'ATMs dikhao' + [ATTACHED_BOUNDARY_CONTEXT] → playground_agent(get_osm_query → run_osm_query with attached polygon) → verify\n" +
  "   'Is map par kitne features / rows hain?' → duckdb_agent(run_client_duckdb_query with COUNT on map_features) → verify\n" +
  "   'Top 5 features by rating / population dikhao' → duckdb_agent(run_client_duckdb_query with ORDER BY) → verify\n" +
  "   'Ye taxi data analyze karo https://...' → duckdb_agent(run_duck_db_queries) → verify\n" +
  "   'Isme kitni rides hain?' → duckdb_agent(run_duck_db_queries with COUNT) → verify\n" +
  "   'Top 10 longest trips dikhao' → duckdb_agent(run_duck_db_queries with ORDER BY) → verify\n" +
  "   'Har vendor ki earning batao' → duckdb_agent(run_duck_db_queries or run_client_duckdb_query with GROUP BY) → verify\n" +
  "   'Color code by type' → map_ui_agent(map_style_layer category) → verify\n" +
  "   'Best/Average/Poor me classify karo green/yellow/red' → map_ui_agent(map_style_layer with ranges & sourceField) → verify\n" +
  "   'Population ke hisab se gradient lagao' → map_ui_agent(map_style_layer gradient) → verify\n" +
  "   'Sab features ko red kardo' → map_ui_agent(map_style_layer solid) → verify\n" +
  "   'Styling hata do / reset colors' → map_ui_agent(map_clear_layer_style) → verify\n" +
  "\n" +
  "ANTI-PATTERNS — CRITICAL:\n" +
  "   ❌ NEVER dump a small 50-row SQL table into query panel when user asked to visually style the entire layer on the map without applying it to the map.\n" +
  "   ❌ NEVER reuse agent from previous turn. Every turn = FRESH classification.\n" +
  "   ❌ 'Find restaurants' is MAPBOX, not Playground. Playground is ONLY for zip/layers/OSM/DuckDB.\n" +
  "   ❌ NEVER write user-facing text yourself. Only verifying_agent does that.\n" +
  "   ❌ NEVER skip verifying_agent — it is MANDATORY after every work cycle.";

const VERIFYING_AGENT_SKILL =
  "VERIFICATION CHECKLIST — check ALL of these:\n" +
  "\n" +
  "1. Did the work agent use the CORRECT tool? (e.g., directions_tool for routes, NOT distance_tool; run_client_duckdb_query for map layers, NOT run_duck_db_queries)\n" +
  "2. Was Response_URL returned as-is (not fetched/queried by the agent)?\n" +
  "3. If map display was needed, did map_ui_agent execute it? If user attached files ([ATTACHED_LOCAL_FILES]), did map_ui_agent load all of them?\n" +
  "4. Were ALL parts of the user's request addressed? (e.g., user asked for BOTH search + zoom, or multiple files, or area calculation)\n" +
  "5. Were coordinates geocoded, not guessed?\n" +
  "6. For SQL / layer queries: was run_client_duckdb_query executed so results show in the query panel, and was a clear 1-2 sentence summary provided? (Never say table does not exist or ask to re-fetch boundary data)\n" +
  "\n" +
  "RESPONSE FORMAT RULES:\n" +
  "   - Multiple places found / Ambiguous locations → List the candidate places with city/state/country context and ALWAYS append `[OPTION: <place name>]` chips for each option so the user can click them directly in chat.\n" +
  "   - Multiple places found (search results) → Markdown TABLE with #, Name, Distance, Category.\n" +
  "   - Route/directions → Blockquote summary (distance, ETA, via). Inline code for road names.\n" +
  "   - Single location → Inline code for name+coords. Blockquote for full address.\n" +
  "   - Always end with ONE short, context-aware follow-up question. Provide 2-3 `[OPTION: <action>]` chips for recommended next steps (e.g. `[OPTION: Show route on map]`, `[OPTION: Find nearby hotels]`).\n" +
  "   - NEVER generate tables from general knowledge. Only from actual tool results.";

export function createADKAgent(
  apiKey?: string,
  userPrompt?: string,
  spatialDataBuffer?: SpatialDataBuffer,
  tabularDataBuffer?: TabularDataBuffer,
  modelId?: string,
) {
  // Shared buffer for intercepted spatial data (route.ts reads this after runner completes)
  const _spatialBuffer: SpatialDataBuffer = spatialDataBuffer || [];
  // Shared buffer for intercepted DuckDB tabular data
  const _tabularBuffer: TabularDataBuffer = tabularDataBuffer || [];
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

  const clientDuckDbTool = adkClientTools.find(
    (t) => t.name === "run_client_duckdb_query",
  );

  const styleLayerTool = adkClientTools.find(
    (t) => t.name === "map_style_layer",
  );

  const clearStyleTool = adkClientTools.find(
    (t) => t.name === "map_clear_layer_style",
  );

  const mapUiClientTools = adkClientTools.filter(
    (t) => t.name !== "run_client_duckdb_query",
  );

  // 2. Set up the Mapbox MCP Toolset (filtering out Claude Desktop iframe UI tools)
  console.log(`[Mapbox MCP] Query: "${userPrompt || "none"}"`);
  console.log(
    `[Mapbox MCP] Loading Mapbox spatial tools (excluding UI render tools)`,
  );

  class FilteredMapboxMCPToolset extends MCPToolset {
    private disallowed = new Set(["render_map_tool", "static_map_image_tool"]);

    override async getTools(context?: any) {
      const tools = await super.getTools(context);
      return tools.filter((t: any) => !this.disallowed.has(t.name));
    }
  }

  const mapboxMcpToolset = new FilteredMapboxMCPToolset({
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

  // 3. Set up the Playg MCP Toolsets
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
        INSTANCE_PATH: "/Users/vishalkushwaha/test.duckdb",
        FILE_PATH: "",
      } as Record<string, string>,
    },
  });

  // Filtered Playg toolset for playground_agent (removes run_duck_db_queries so it never attempts backend SQL)
  class FilteredPlaygMCPToolset extends MCPToolset {
    private disallowed = new Set(["run_duck_db_queries"]);

    override async getTools(context?: any) {
      const tools = await super.getTools(context);
      return tools.filter((t: any) => !this.disallowed.has(t.name));
    }
  }

  const playgroundMcpToolset = new FilteredPlaygMCPToolset({
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
        INSTANCE_PATH: "/Users/vishalkushwaha/test.duckdb",
        FILE_PATH: "",
      } as Record<string, string>,
    },
  });

  const effectiveApiKey =
    (apiKey && apiKey.trim()) || process.env.GEMINI_API_KEY;
  if (!effectiveApiKey) {
    throw new Error("Missing API Key. Please provide an API key in Settings.");
  }

  const selectedModel = (modelId && modelId.trim()) || "gemini-3.5-flash";
  console.log(
    `🤖 [ADK Agent] Initializing with Model: "${selectedModel}", API Key provided (${effectiveApiKey.slice(0, 6)}...${effectiveApiKey.slice(-4)})`,
  );

  const modelToUse = new Gemini({
    model: selectedModel,
    apiKey: effectiveApiKey,
  });

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

      let suffix = Math.random().toString(36).slice(2, 6);
      if (params.args) {
        const val = Object.values(params.args)[0];
        if (typeof val === "string") {
          suffix = val.substring(0, 20);
        }
      }
      const uniqueLabel = `${toolName}_${suffix}`;

      if (!normalized && rawParsed?._needsMcpResolve && rawParsed?._mapboxUri) {
        // Resolve directions and isochrone selffetch URIs immediately so LLM gets a rich summary
        if (
          rawParsed._mapboxUri.includes("mapbox://selffetch/directions") ||
          rawParsed._mapboxUri.includes("mapbox://selffetch/isochrone")
        ) {
          console.log(
            `  ↳ Resolving selffetch URI immediately: ${rawParsed._mapboxUri}`,
          );
          try {
            const { fetchAndNormalizeSpatialUrl } =
              await import("@/utils/spatialNormalizer");
            normalized = await fetchAndNormalizeSpatialUrl(
              rawParsed._mapboxUri,
              uniqueLabel,
            );
            if (normalized?.features?.length > 0) {
              console.log(
                `  ✅ Successfully resolved ${normalized.features.length} features (including route LineString) for ${toolName}!`,
              );
            }
          } catch (e) {
            console.error(
              `  ↳ Failed to resolve selffetch URI immediately:`,
              e,
            );
          }
        }
      }

      if (!normalized && rawParsed?._needsMcpResolve && rawParsed?._mapboxUri) {
        // Fallback: MCP URI resolution needs the route-level resolver — store the URI for route to handle
        console.log(
          `  ↳ mapbox:// URI detected, storing for route-level resolution: ${rawParsed._mapboxUri}`,
        );
        _spatialBuffer.push({
          toolName,
          label: uniqueLabel,
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
          label: uniqueLabel,
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

  // ─── Tabular Data Interceptor: intercepts DuckDB query results ──────────
  const tabularInterceptCallback = async (params: {
    tool: any;
    args: Record<string, unknown>;
    context: any;
    response: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> => {
    const toolName = params.tool?.name || "unknown_tool";

    // Only intercept DuckDB query tools
    if (toolName !== "run_duck_db_queries") {
      return undefined;
    }

    console.log(
      `📊 [Tabular Interceptor] Intercepting DuckDB result from: ${toolName}`,
    );

    try {
      const queryText = (params.args?.queryText as string) || "";
      const result = await extractTabularFromResponse(
        toolName,
        params.response,
        queryText,
      );

      if (!result) {
        console.log(
          `  ↳ No tabular data found in ${toolName} response. Passing through.`,
        );
        return undefined;
      }

      console.log(
        `  ✅ Intercepted ${result.rowCount} rows, ${result.columns.length} columns from ${toolName}. LLM gets summary only.`,
      );

      // Store in shared buffer for route.ts to read
      _tabularBuffer.push(result);

      // If the query returned spatial geometries, convert rows into GeoJSON FeatureCollection
      // and push to _spatialBuffer so DeckGL map automatically renders boundaries/points!
      if (
        result.hasSpatialColumn &&
        result.spatialColumnName &&
        result.rows.length > 0
      ) {
        const spatialColIdx = result.columns.indexOf(result.spatialColumnName);
        if (spatialColIdx >= 0) {
          const layerId = `duckdb_${result.queryId}`;
          const features: any[] = [];

          for (let rowIdx = 0; rowIdx < result.rows.length; rowIdx++) {
            const row = result.rows[rowIdx];
            const spatialVal = row[spatialColIdx];
            let geom: any = null;

            if (
              spatialVal &&
              typeof spatialVal === "object" &&
              (spatialVal as any).type
            ) {
              geom = spatialVal;
            } else if (typeof spatialVal === "string") {
              try {
                let cleaned = spatialVal.trim();
                if (cleaned.startsWith('"{"\''))
                  cleaned = cleaned
                    .substring(1, cleaned.length - 1)
                    .replace(/""/g, '"');
                if (cleaned.startsWith("{")) geom = JSON.parse(cleaned);
              } catch {}
            }

            if (geom) {
              const properties: Record<string, any> = {
                layerId,
                featureId: `${result.queryId}_${rowIdx}`,
              };
              result.columns.forEach((col, idx) => {
                if (idx !== spatialColIdx) {
                  properties[col] = row[idx];
                }
              });
              features.push({
                type: "Feature",
                geometry: geom,
                properties,
              });
            }
          }

          if (features.length > 0) {
            const featureCollection = {
              type: "FeatureCollection",
              features,
              properties: {
                title: `DuckDB: ${features.length} features`,
                source_url: "duckdb",
                layerId,
              },
            };
            console.log(
              `  🗺️ [Tabular Interceptor] Auto-extracted ${features.length} spatial features for DeckGL map rendering.`,
            );
            _spatialBuffer.push({
              toolName,
              label: `DuckDB: ${features.length} boundaries`,
              geojson: featureCollection,
              metadata: {
                featureCount: features.length,
                summary: `DuckDB spatial query: ${features.length} boundaries/features rendered on map`,
              },
            });
          }
        }
      }

      // Generate lightweight summary for LLM
      const summary = createTabularSummary(result);

      return {
        content: [{ type: "text", text: summary }],
        _tabularDataExtracted: true,
      };
    } catch (err) {
      console.error(`[Tabular Interceptor] Error processing ${toolName}:`, err);
    }

    return undefined;
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
- NEVER call render_map_tool or attempt to render maps. You are a DATA specialist only. Spatial data returned by your tools is automatically extracted and displayed on the DeckGL map by the server.
- NEVER attempt to call tools you don't have. If the user's request needs map UI actions (zoom, rotate, fly, draw), complete YOUR data work and return your summary. The planner will route map UI tasks to map_ui_agent separately.
- If you accidentally try to call a tool you don't own, the system will crash with an error. This is YOUR fault — avoid it.

EXECUTION RULES:
- Execute the requested tool(s) and return a clear technical summary with all geographic data found.
- CRITICAL: If a tool returns a URI, URL, or data reference (e.g. Response_URL, mapbox://temp/...) for spatial data, DO NOT try to fetch, query, or read it yourself. Simply return the URL reference as it is to the parent.
- DO NOT call render_map_tool. DO NOT attempt to render the map.
- DO NOT generate a final user-facing response. DO NOT transfer to any other agent.
- When you are DONE, simply return your summary — control will automatically go back to your parent agent.
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
    tools: [mapboxMcpToolset, hitlTool],
    beforeToolCallback: toolGuardrailCallback,
    afterToolCallback: spatialInterceptCallback,
  });

  // ─── Sub-Agent 2: Playground Agent (Playg MCP Tools) ───────────
  const playgroundAgent = new LlmAgent({
    model: modelToUse,
    name: "playground_agent",
    description:
      "Handles Playground platform data: zip boundary data, user layers, OSM queries.",
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
    tools: [playgroundMcpToolset, hitlTool],
    beforeToolCallback: toolGuardrailCallback,
    afterToolCallback: spatialInterceptCallback,
  });

  // ─── Sub-Agent 2b: DuckDB Agent (Spatial SQL Analytics) ───────────
  const duckdbAgent = new LlmAgent({
    model: modelToUse,
    name: "duckdb_agent",
    description:
      "Handles spatial data analysis on user-provided files, URLs, or existing tables using DuckDB SQL queries.",
    instruction: `You are the DuckDB Spatial SQL analyst. You analyze data files, URLs, and tables using DuckDB SQL.

${DUCKDB_AGENT_SKILL}

STRICT GUARDRAIL (PREVENT INFINITE LOOPS):
- If your query returns an error or no results, you are allowed a MAXIMUM of 3 retries with modified queries.
- After 3 failed attempts, you MUST STOP and return the error or empty result summary. Do NOT keep trying endlessly.

AGENT BOUNDARY (CRITICAL — VIOLATION CAUSES SYSTEM CRASH):
- You do NOT have access to map display tools (map_rotate, map_zoom_in, map_fly_to, etc.).
- You do NOT have access to Mapbox MCP tools (search_and_geocode_tool, directions_tool, etc.).
- You do NOT have access to Playground tools (get_zip_data, get_osm_query, get_user_layers).
- Your tools are run_client_duckdb_query (for client-side SQL on loaded map layers), run_duck_db_queries (for heavy backend analysis), and map_style_layer / map_clear_layer_style (when the user asks to visually color or style a map layer). NEVER attempt to call any other tool.
- If you accidentally try to call a tool you don't own, the system will crash.

EXECUTION RULES:
- Understand the user's intent (in Hindi/Hinglish/English) and translate it to an optimized DuckDB SQL query.
- If the user asks to color, style, or categorize features or layers: you have access to map_style_layer! Use valueGroups, rules, or direct category mapping. If SQL filtering is required by the user, pass applyToMap: true in run_client_duckdb_query so the filtered features appear as an active layer on the map, then style them. Avoid dumping a plain 50-row unapplied table when full layer map styling was requested.
- For most queries on visible map layers (including heavy spatial analysis if the user intends it), call run_client_duckdb_query.
- Only call run_duck_db_queries if the analysis explicitly requires backend processing or massive remote files not suited for the browser.
- Return a clear technical summary of what the query did and key findings.
- DO NOT reproduce all data rows in your response — the system sends results to the client automatically.
- DO NOT generate a final user-facing response. DO NOT transfer to any other agent.
- When you are DONE, simply return your summary.
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
    tools: [
      playgMcpToolset,
      ...(clientDuckDbTool ? [clientDuckDbTool] : []),
      ...(styleLayerTool ? [styleLayerTool] : []),
      ...(clearStyleTool ? [clearStyleTool] : []),
      hitlTool,
    ],
    beforeToolCallback: toolGuardrailCallback,
    afterToolCallback: tabularInterceptCallback,
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
- You do NOT have access to Playground tools (get_zip_data, get_osm_query, run_osm_query, run_duck_db_queries, get_user_layers) or DuckDB tools (run_client_duckdb_query).
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
    tools: mapUiClientTools,
    beforeToolCallback: toolGuardrailCallback,
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

DO NOT call any tools. DO NOT use the mapbox_agent, playground_agent, duckdb_agent, map_ui_agent, or planner_agent tools. DO NOT transfer to any agent. Just analyze the history and respond directly to the user.
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
    tools: [hitlTool],
    beforeToolCallback: toolGuardrailCallback,
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
- 'playground_agent': Zip boundary data, user layers, OSM queries — anything platform/Playground.
- 'duckdb_agent': Analyze datasets, files (Parquet, CSV, GeoJSON, Shapefile), URLs, map layers, or existing DuckDB tables using SQL queries. Automatically uses client-side DuckDB (run_client_duckdb_query) for most queries (including heavy/complex analysis if intended by user) on visible map layers, or backend (run_duck_db_queries) for backend-specific remote analysis.
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
- Failed tool is a platform tool (get_zip_*, get_osm_*, get_user_*) → Route to playground_agent
- Failed tool is run_duck_db_queries or run_client_duckdb_query → Route to duckdb_agent
After re-routing, verify again with verifying_agent.
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
    tools: [hitlTool],
    beforeToolCallback: toolGuardrailCallback,
    subAgents: [
      mapboxAgent,
      playgroundAgent,
      duckdbAgent,
      mapUiAgent,
      verifyingAgent,
    ],
  });

  const rootAgent = new LlmAgent({
    model: modelToUse,
    name: "root_agent",
    description:
      "Main entry point — handles general chat or delegates map/data work to planner.",
    instruction: `You are Mapsense AI — a smart map assistant.

ROUTING — follow these rules for EVERY message:
1. GENERAL CHAT (greetings, "what can you do?", jokes, chitchat) → Answer directly yourself.
2. ANYTHING MAP/DATA/SQL RELATED → Transfer to 'planner_agent' IMMEDIATELY. Do not answer yourself.

Map/data/SQL includes: search, directions, zoom, draw, zip data, show on map, clear map, base map, SQL queries, layer analysis, area calculations, [SELECTED_MAP_LAYERS], [MAP_SQL_CONTEXT], and ALL follow-up requests like "ab isko map pe dikhao", "zoom in karo", "search another place", "clear karo".
${LANG_RULE}
${HITL_RULE}
${AGENT_SAFETY_STAND_RULE}`,
    tools: [hitlTool],
    beforeToolCallback: toolGuardrailCallback,
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
    tabularDataBuffer: _tabularBuffer,
  };
}
