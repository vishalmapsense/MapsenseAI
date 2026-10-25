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
import { getAmenityCategoryAndColor } from "./utils/amenityColors";

// Shared language constraint for all agents
const LANG_RULE =
  "LANGUAGE POLICY (CRITICAL):\n" +
  "- Match the user's language: ALWAYS respond in the EXACT same language that the user used to ask their question (e.g., if the user asks in Hindi, answer in Hindi; if in Hinglish, answer in Hinglish; if in any other language, answer in that language).\n" +
  "- Default Preference: English is the primary and preferred default language. If the user asks in English, or if their language preference is neutral, mixed, or ambiguous, ALWAYS respond in clear, professional English.\n" +
  "- Consistency: Maintain the chosen language consistently throughout the entire response without unnecessary language switching.";
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
  "   Available queries:\n" +
  "   - 'Polygon Search' (queryId: '610acbb8-9d09-463b-bfcd-74b03e89082f'): Fetches amenities strictly INSIDE a polygon boundary using parameter 'poly' (format: 'lat1 lon1 lat2 lon2 ...'). PREFERRED for any region or zipcode search!\n" +
  "   - 'Nearby Search' (queryId: 'aa7cd1cc-8936-4d6c-b8a5-0fd59436395e'): Fetches amenities in a radius around a point using parameters { radius, latitude, longitude }.\n" +
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
  "BOUNDARY/REGION SEARCH & ZIPCODE SCORING RULE (CRITICAL):\n" +
  "  When calculating the Location Score (LocusScore) or evaluating amenities for any PIN / ZIP code or boundary:\n" +
  "  Follow this exact 4-step workflow:\n" +
  "  Step 1: Boundary & Centroid — Call get_zip_data(key='zipcode', value='<zipcode>') (or get_district_data) to fetch the polygon boundary coordinates, office name, and centroid.\n" +
  "  Step 2: OSM Query Template — For boundary queries, use Polygon Search queryId '610acbb8-9d09-463b-bfcd-74b03e89082f' with parameter { poly: '<lat1 lon1 lat2 lon2 ...>' } to fetch amenities natively inside the polygon boundary. Alternatively, the system automatically translates radial queries to polygon boundary queries.\n" +
  "  Step 3: Fetch Amenities — Call run_osm_query with queryId '610acbb8-9d09-463b-bfcd-74b03e89082f' and parameters: { poly: '<lat1 lon1 lat2 lon2 ...>' } (or Nearby Search queryId 'aa7cd1cc-8936-4d6c-b8a5-0fd59436395e' where the system guardrail will automatically inject the poly parameter from the boundary). NOTE: Amenities MUST be in key=value format like 'amenity=hospital' (never just 'hospital'). STRICT BOUNDARY RULE: Only POIs strictly inside the boundary polygon are returned.\n" +
  "  Step 4: Score Calculation — Calculate the LocusScore using the distance-decay formula: AmenityValue = Σ [ 1 / (1 + distance / 0.5) ] across the 8 categories and sector profiles (Real Estate, FMCG/Retail, Quick-Commerce) and display the boundary and inside POIs on the map.\n" +
  "\n" +
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
  "     - Geometry Column: 'geometry' is ALREADY stored as a GeoJSON string (VARCHAR). NEVER call ST_AsGeoJSON(geometry) — simply use `geometry` or `SELECT *`!\n" +
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
  "- When the user asks to COLOR, STYLE, HIGHLIGHT, EXTRUDE (3D), or CATEGORIZE a layer or its features (e.g. 'color karo', 'region ke basis par color', '3D me dikhao', 'color code by speed', 'sab features ko red kardo', 'gold outline do'):\n" +
  "  1. ❌ DO NOT run a SQL SELECT query (e.g., SELECT ... FROM ... LIMIT 50 or GROUP BY) that dumps filtered rows into the Query Results table! The user wants to view ALL the data on the map styled with colors, not a filtered subset in a table.\n" +
  "  2. ✅ Call 'map_style_layer' directly!\n" +
  "     * Discrete category: map_style_layer(layerIndex=0, style={ type: 'category', field: 'region' })\n" +
  "     * 3D Extrusion by metric: map_style_layer(layerIndex=0, style={ type: 'gradient', field: 'population', extruded: true, elevationField: 'population', elevationScale: 0.5, minColor: '#3b82f6', maxColor: '#ef4444' })\n" +
  "     * Outline / boundary highlight: map_style_layer(layerIndex=0, style={ type: 'solid', filled: false, stroked: true, lineColor: 'gold', lineWidth: 3 })\n" +
  "     * Continuous numeric into Best/Average/Poor: map_style_layer(layerIndex=0, style={ type: 'category', field: 'network_category', sourceField: 'avg_d_kbps', ranges: [...] })\n" +
  "     * Gradient example: map_style_layer(layerIndex=0, style={ type: 'gradient', field: 'avg_d_kbps', minColor: '#ef4444', maxColor: '#22c55e' })\n" +
  "  3. Calling 'map_style_layer' styles ALL features across the layer instantly on the map.\n\n" +
  "TABLE / DATASET EXPLORATION INTENT (CRITICAL):\n" +
  "- When the user explicitly asks for a TABLE, table representation, or says 'table me karoo', 'table dikhao', 'show table', 'paired with a table':\n" +
  "  1. You MUST call 'run_client_duckdb_query' with a valid, complete SQL query in 'queryText'!\n" +
  '     Example for tracts/population: SELECT * EXCLUDE (geometry), geometry AS geometry FROM "<tableName>" ORDER BY "Population" DESC LIMIT 20;\n' +
  '     Example for least populated: SELECT * EXCLUDE (geometry), geometry AS geometry FROM "<tableName>" ORDER BY "Population" ASC LIMIT 20;\n' +
  "  2. NEVER call run_client_duckdb_query with an empty or missing queryText.\n" +
  "  3. If user ALSO asked to highlight/style the map layer (e.g. 'highlight the 10-20 tracts paired with a table'):\n" +
  "     Call run_client_duckdb_query (with applyToMap: true if user wants filtered layer) AND/OR map_style_layer.\n\n" +
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
  "   - ❌ NEVER return raw/binary geometry columns (WKB/WKT) from st_read(). They CANNOT be displayed on the map.\n" +
  "   - ✅ For raw binary geometry (e.g. st_read('URL')): ALWAYS convert geometry to GeoJSON using ST_AsGeoJSON(geom).\n" +
  "   - ❌ WRONG for st_read: SELECT * FROM st_read('URL'); (returns raw binary geom)\n" +
  "   - ❌ WRONG: SELECT *, ST_AsGeoJSON(geom) AS geom FROM my_data; (duplicates the column, breaks the map)\n" +
  "   - ✅ CORRECT for st_read: SELECT * EXCLUDE (geom), ST_AsGeoJSON(geom) AS geom FROM st_read('URL');\n" +
  "   - ⚠️ CRITICAL FOR CLIENT MAP LAYERS (run_client_duckdb_query):\n" +
  "     * The 'geometry' column in client DuckDB tables is ALREADY a GeoJSON string (VARCHAR)!\n" +
  "     * ❌ NEVER call ST_AsGeoJSON(geometry) or ST_AsGeoJSON(geom) on client map layers — it causes DuckDB Binder Error 'No function matches ST_AsGeoJSON(VARCHAR)'.\n" +
  "     * ✅ Simply select the column directly: SELECT * FROM \"tableName\" or SELECT * EXCLUDE (geometry), geometry AS geometry FROM ...\n" +
  "     * To highlight/filter features on the map, call run_client_duckdb_query with applyToMap: true.\n" +
  "   - Returning GeoJSON causes the boundaries to automatically render on the map for the user!\n" +
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
  "F) Layer Styling: map_style_layer, map_clear_layer_style — Apply or remove visual styling to map layers.\n" +
  "   CRITICAL DETERMINISTIC CONTRACT (100% MATCH BETWEEN WHAT YOU DECIDE & WHAT APPEARS ON THE MAP):\n" +
  "   1. YOU (THE AGENT) DECIDE THE EXACT COLORS & LAYER TYPE:\n" +
  "      Never leave colors or layer types unspecified or random!\n" +
  "      • When styling categories or value groups, ALWAYS provide explicit `mapping: { '<CategoryName>': { fillColor: '<exact_color>' } }`.\n" +
  "      • When applying solid colors, ALWAYS provide explicit `fillColor: '<exact_color>'` (and optional `lineColor`).\n" +
  "      • When applying gradients, ALWAYS provide explicit `minColor: '<exact_color>', maxColor: '<exact_color>'` (or `colorRange`).\n" +
  "   2. COMPLETE LAYER TYPES YOU CAN FREELY CHOOSE (visualizationType):\n" +
  "      • 'GeoJsonLayer' — Standard polygon/line/point vectors (2D choropleths or 3D extrusions with extruded: true, outlines with filled: false)\n" +
  "      • 'HeatmapLayer' — Smooth Gaussian heat density surface for point datasets\n" +
  "      • 'HexagonLayer' — 3D hexagonal bins with dynamic elevation based on counts/sums\n" +
  "      • 'ScatterplotLayer' — High-performance circle points with custom radius\n" +
  "      • 'GridLayer' — 3D square grid cell aggregation\n" +
  "   3. COMPLETE DETERMINISTIC COLOR PALETTE (Use these exact hex codes or names):\n" +
  "      • Red: '#ef4444' | Crimson: '#dc2626' | Ruby: '#e11d48' | Rose: '#f43f5e'\n" +
  "      • Blue: '#3b82f6' | Royal: '#2563eb' | Navy: '#1e3a8a' | Sky: '#0ea5e9'\n" +
  "      • Green: '#22c55e' | Emerald: '#10b981' | Forest: '#166534' | Lime: '#84cc16'\n" +
  "      • Yellow: '#eab308' | Gold: '#f59e0b'\n" +
  "      • Orange: '#f97316' | Amber: '#d97706'\n" +
  "      • Purple: '#a855f7' | Violet: '#8b5cf6' | Indigo: '#6366f1'\n" +
  "      • Cyan: '#06b6d4' | Teal: '#14b8a6' | Turquoise: '#2dd4bf'\n" +
  "      • Pink: '#ec4899' | Magenta: '#d946ef'\n" +
  "      • Neutral: Slate '#64748b' | Dark '#1e293b' | White '#ffffff'\n" +
  "   4. 1:1 CHAT AGREEMENT MANDATE:\n" +
  "      The exact color names and hex codes you pass in map_style_layer MUST BE THE EXACT ONES described to the user in chat.\n" +
  "      NEVER say in chat 'I colored South blue' if you passed a different color in the tool call!\n" +
  "   Supports rich styling modes:\n" +
  "   - 'category': Color features by discrete category OR numeric thresholds.\n" +
  "     * Custom mapping (RECOMMENDED FOR DETERMINISM):\n" +
  "       map_style_layer(layerIndex=0, style={ type: 'category', field: 'region', mapping: { 'South': { fillColor: '#3b82f6', label: 'South' }, 'North': { fillColor: '#ef4444', label: 'North' } } })\n" +
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
  "           'Best': { fillColor: '#22c55e', label: 'Best (>= 25 Mbps)' },\n" +
  "           'Average': { fillColor: '#eab308', label: 'Average (10-25 Mbps)' },\n" +
  "           'Poor': { fillColor: '#ef4444', label: 'Poor (< 10 Mbps)' }\n" +
  "         }\n" +
  "       })\n" +
  "   - 'gradient': Color features by numeric range with explicit minColor & maxColor.\n" +
  "     Example: map_style_layer(layerIndex=0, style={ type: 'gradient', field: 'avg_d_kbps', minColor: '#ef4444', maxColor: '#22c55e' })\n" +
  "     Multi-stop gradient example:\n" +
  "       map_style_layer(layerIndex=0, style={ type: 'gradient', field: 'population', colorRange: ['#1e3a8a', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'] })\n" +
  "   - 'solid': Apply a flat single color or outline.\n" +
  "     Example: map_style_layer(layerIndex=0, style={ type: 'solid', fillColor: '#3b82f6' })\n" +
  "   - 3D EXTRUSION (Polygons with 3D height based on metrics):\n" +
  "     Set extruded: true, elevationField, and elevationScale. The map perspective automatically tilts to 3D (pitch 45°)!\n" +
  "     Example: map_style_layer(layerIndex=0, style={ type: 'gradient', field: 'population', extruded: true, elevationField: 'population', elevationScale: 0.5, minColor: '#3b82f6', maxColor: '#ef4444' })\n" +
  "   - BOUNDARY / OUTLINE-ONLY HIGHLIGHTING:\n" +
  "     Set filled: false, stroked: true, lineWidth: 3, lineColor: 'gold' (or hex/RGBA).\n" +
  "     Example: map_style_layer(layerIndex=0, style={ type: 'solid', filled: false, stroked: true, lineColor: '#f59e0b', lineWidth: 3 })\n" +
  "   - VISUALIZATION TYPES (Layer Switching):\n" +
  "     Convert layer rendering to 'HeatmapLayer', 'HexagonLayer', 'ScatterplotLayer', or 'GridLayer'.\n" +
  "     Example: map_style_layer(layerIndex=0, style={ visualizationType: 'HeatmapLayer', radiusPixels: 40 })\n" +
  "     Example: map_style_layer(layerIndex=0, style={ visualizationType: 'HexagonLayer', extruded: true, radius: 1000 })\n" +
  "   - Dynamic Point Sizing / Bubbles:\n" +
  "     Add 'sizeField' (e.g. 'population') or 'pointRadius' (default: 25, range: 2 to 100) to scale circle sizes on point layers.\n" +
  "   Use map_clear_layer_style(layerIndex) to remove styling and revert to default.\n" +
  "   G) LocusScore PIN Intelligence (Dual PIN & Zip Code Comparison):\n" +
  "   - compare_pincodes_locus_score(pinCodeA, pinCodeB, sector, specificAmenities, d0, renderOnMap):\n" +
  "     Compares any two Indian PIN codes or zip codes across 8 OSM amenity categories:\n" +
  "     (1) Education (schools, colleges, universities — biggest home-buying driver),\n" +
  "     (2) Healthcare (hospitals, clinics, pharmacies — emergency golden-hour access),\n" +
  "     (3) Daily Needs & Retail (supermarkets, convenience kiranas, marketplaces — daily livability),\n" +
  "     (4) Food & Beverage (restaurants, cafes, fast food — footfall & lifestyle proxy),\n" +
  "     (5) Banking & Finance (banks, ATMs — trust and cash signal),\n" +
  "     (6) Transit & Connectivity (bus stops, railway stations, metro — commute radius),\n" +
  "     (7) Recreation & Open Space (parks, playgrounds, lakes — wellness & open space),\n" +
  "     (8) Civic & Community (places of worship, police, post office — neighbourhood safety & identity).\n" +
  "     Applies 5-step distance decay: AmenityValue = Σ [ 1 / (1 + distance_km / d0) ] (d0 ≈ 0.5 km) with 1 km buffer and city-wide min-max normalization (0-100).\n" +
  "     Sector profiles: 'real_estate' (20% edu, 15% health, 15% daily, 5% f&b, 5% bank, 20% transit, 10% rec, 10% civic),\n" +
  "     'fmcg_retail' (10% edu, 5% health, 25% daily, 15% f&b, 10% bank, 20% transit, 5% rec, 10% civic),\n" +
  "     or 'quick_commerce' (5% edu, 10% health, 20% daily, 10% f&b, 5% bank, 25% transit, 0% rec, 25% civic).\n" +
  "     Automatically renders POI markers with category colors and 1 km buffer zones on the map!\n" +
  "   - score_pincode_locus(pinCode, sector, specificAmenities, d0, renderOnMap): Evaluates a single PIN code.\n" +
  "\n" +
  "STYLING WORKFLOW — FULLY FLEXIBLE FOR ANY USER INTENT (CRITICAL):\n" +
  "   When a user asks to categorize, color-code, highlight, extrude, or classify features on a layer (e.g. 'south and north ke basis par color karo', 'color by status', '3D me dikhao', 'filter karke color karo'):\n" +
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
  "          'South': { fillColor: '#3b82f6' },\n" +
  "          'North': { fillColor: '#ef4444' }\n" +
  "        }\n" +
  "      })\n" +
  "      The engine maps features matching these values and tags them with the category!\n" +
  "   3. RULES: For conditions or comparisons (e.g. lat < 20, rating > 4, pop > 50000):\n" +
  "      map_style_layer(layerIndex=0, style={ type: 'category', rules: [ { category: 'South', condition: 'lat < 20', fillColor: '#3b82f6' }, { category: 'North', condition: 'lat >= 20', fillColor: '#ef4444' } ] })\n" +
  "   4. 3D EXTRUSION: For 3D building / block heights by metric:\n" +
  "      map_style_layer(layerIndex=0, style={ type: 'gradient', field: 'population', extruded: true, elevationField: 'population', elevationScale: 0.5, minColor: '#3b82f6', maxColor: '#ef4444' })\n" +
  "   5. OUTLINE ONLY / BOUNDARIES: Set filled: false, stroked: true, lineWidth: 3, lineColor: 'gold'.\n" +
  "   6. FILTER + COLOR: Set dimUnmatched: true (dims other features to faint gray) or hideUnmatched: true (hides others).\n" +
  "   7. RANGES: For continuous numeric thresholds (Best/Average/Poor), use 'ranges'.\n" +
  "   8. DUCKDB FILTERING: If the user asks to filter data via SQL, call run_client_duckdb_query with applyToMap: true to display filtered features on the map, then style with map_style_layer.\n" +
  "\n" +
  "CRITICAL RULES:\n" +
  "   - map_load_url is for user-provided HTTP/HTTPS URLs AND local file paths from [ATTACHED_LOCAL_FILES] (including .geojson, .parquet, .csv, and .json).\n" +
  "     NEVER use it for mapbox://temp/... or Response_URL (those auto-render).\n" +
  "   - ATTACHED LOCAL FILES RULE (CRITICAL):\n" +
  "     When the user attaches local files ([ATTACHED_LOCAL_FILES]), you MUST extract ALL file paths listed.\n" +
  "     If there are multiple files (e.g. 2 files), call `map_load_url` for EACH file separately!\n" +
  "     Example with files:\n" +
  "       1. map_load_url(url='/path/to/file1.geojson', label='file1')\n" +
  "       2. map_load_url(url='/path/to/data.parquet', label='data')\n" +
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
  "   Q0_LOCUS (PIN / ZIP CODE SCORING, COMPARISON & LOCUSSCORE — HIGHEST PRIORITY):\n" +
  "       Does the user ask about PIN CODE COMPARISON, ZIP CODE COMPARISON, LOCATION SCORE, or LOCUSSCORE?\n" +
  "       (Keywords: 'compare 560001 and 560103', '560001 vs 560103', '560001 aur 560103 compare karo', 'pincode compare', 'zip code compare', 'neighbourhood score', 'locus score', 'calculate location score for 560001', '560001 ka score', 'pincode score', 'MG road vs Sarjapur', 'real estate score for pincode', 'retail score for pincode', 'dark store location')\n" +
  "       - 4-STEP WORKFLOW TO SCORE ANY ZIPCODE:\n" +
  "         1. Boundary: Fetch zipcode boundary and centroid using get_zip_data(key='zipcode', value='...').\n" +
  "         2. OSM Query: Fetch canned query template using get_osm_query.\n" +
  "         3. Amenities Data: Fetch OSM amenities using run_osm_query with queryId, parameters (radius, latitude, longitude), and requested category amenities.\n" +
  "         4. LocusScore: Calculate score using distance-decay formula: AmenityValue = Σ [ 1 / (1 + distance / 0.5) ] across the 8 categories and sector weights (Real Estate, FMCG/Retail, Quick-Commerce).\n" +
  "       - If user provides TWO PIN codes or ZIP codes (e.g. 560001 and 560103):\n" +
  "         → ALWAYS route to map_ui_agent! map_ui_agent calls compare_pincodes_locus_score(pinCodeA, pinCodeB, sector, specificAmenities). Sector defaults to 'real_estate' if not specified. Then send to verifying_agent.\n" +
  "       - If user provides ONE PIN code or ZIP code (e.g. '560001', 'calculate location score for 560001', '560001 ka score batao'):\n" +
  "         → ALWAYS route to map_ui_agent! map_ui_agent calls score_pincode_locus(pinCode, sector). Then send to verifying_agent.\n" +
  "       - If user asks to compare pincodes but DID NOT provide two PIN codes (e.g. 'compare pincodes', 'pincode comparison karo'):\n" +
  "         → Do NOT call tools yet. Send to verifying_agent to prompt user politely with interactive choice chips: [OPTION: Compare 560001 and 560103 for Real Estate] [OPTION: Compare 560001 and 560103 for FMCG / Retail] [OPTION: Compare 110001 and 110020 for Quick-Commerce]!\n" +
  "       - If sector or category is missing or ambiguous: inform the user what baseline was assumed (e.g. Real Estate) and provide clickable options [OPTION: Real Estate] [OPTION: FMCG / Retail] [OPTION: Quick-Commerce]!\n" +
  "   Q0 (COLOR, STYLE, & VISUAL CATEGORIZATION): Does the user want to COLOR, STYLE, HIGHLIGHT, EXTRUDE (3D), CLASSIFY, or VISUALLY CATEGORIZE map features or layers?\n" +
  '       (Keywords: "color karo", "color code", "rang bharo", "style karo", "3d me dikhao", "extrude karo", "height do", "outline do", "boundary highlight", "heatmap banao", "hexagon grid", "south aur north color karo", "region ke basis par color", "speed ke hisab se color", "classify into classes", "sab features ko color karo", "sabko red kardo", "gradient lagao", "styling hata do", "reset style", "apply color", "filter karke color karo")\n' +
  "       → Usually map_ui_agent with map_style_layer (using valueGroups, rules, 3D extrusion, or direct mapping)!\n" +
  "       → If the user specifically asks to query/filter data with SQL first before coloring, duckdb_agent can run run_client_duckdb_query (pass applyToMap: true if user wants filtered layer on map), followed by map_style_layer.\n" +
  "   Q1: Does the message contain [SELECTED_MAP_LAYERS] or [MAP_SQL_CONTEXT], or does the user want SQL analytics / queries / area / counts / statistics on map layers or datasets?\n" +
  "       → ALWAYS duckdb_agent! (NEVER playground_agent, NEVER mapbox_agent). duckdb_agent executes run_client_duckdb_query directly in the user's browser.\n" +
  "   Q2: Does it need GEOGRAPHIC data (routes, distances, isochrones, geocoding)?\n" +
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
  "   '560001 aur 560103 compare karo' → map_ui_agent(compare_pincodes_locus_score) → verify\n" +
  "   'compare 560001 and 560103 for FMCG' → map_ui_agent(compare_pincodes_locus_score with sector='fmcg_retail') → verify\n" +
  "   'calculate location score for 560001' → map_ui_agent(score_pincode_locus) → verify\n" +
  "   '560001 ka score batao' → map_ui_agent(score_pincode_locus) → verify\n" +
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
  "   'find all hospitals in 208002 pincode' → playground_agent(get_zip_data for 208002 → run_osm_query with Polygon Search query 610acbb8-9d09-463b-bfcd-74b03e89082f and poly parameter) → verify\n" +
  "   'Schools in Delhi' → playground_agent(get_district_data for Delhi → run_osm_query with Polygon Search query and boundary poly parameter) → verify\n" +
  "   'ATMs dikhao' + [ATTACHED_BOUNDARY_CONTEXT] → playground_agent(run_osm_query with Polygon Search query and attached polygon poly parameter) → verify\n" +
  "   'Is map par kitne features / rows hain?' → duckdb_agent(run_client_duckdb_query with COUNT on map_features) → verify\n" +
  "   'Top 5 features by rating / population dikhao' → duckdb_agent(run_client_duckdb_query with ORDER BY) → verify\n" +
  "   'Ye taxi data analyze karo https://...' → duckdb_agent(run_duck_db_queries) → verify\n" +
  "   'Isme kitni rides hain?' → duckdb_agent(run_duck_db_queries with COUNT) → verify\n" +
  "   'Top 10 longest trips dikhao' → duckdb_agent(run_duck_db_queries with ORDER BY) → verify\n" +
  "   'Har vendor ki earning batao' → duckdb_agent(run_duck_db_queries or run_client_duckdb_query with GROUP BY) → verify\n" +
  "   'Color code by type' → map_ui_agent(map_style_layer category) → verify\n" +
  "   'Best/Average/Poor me classify karo green/yellow/red' → map_ui_agent(map_style_layer with ranges & sourceField) → verify\n" +
  "   'Population ke hisab se gradient lagao' → map_ui_agent(map_style_layer gradient) → verify\n" +
  "   '3D me dikhao population ke hisab se' → map_ui_agent(map_style_layer with extruded=true, elevationField='population', elevationScale=0.5) → verify\n" +
  "   'Tracts ko gold boundary do bina fill ke' → map_ui_agent(map_style_layer with type='solid', filled=false, stroked=true, lineColor='gold', lineWidth=3) → verify\n" +
  "   'Heatmap banao points ka' → map_ui_agent(map_style_layer with visualizationType='HeatmapLayer', radiusPixels=40) → verify\n" +
  "   'Hexagon 3D grid me convert karo' → map_ui_agent(map_style_layer with visualizationType='HexagonLayer', extruded=true, radius=1000) → verify\n" +
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
  "7. For Layer Styling & Visualization (map_style_layer): Did the agent report the EXACT layer type (e.g. GeoJsonLayer, HeatmapLayer, HexagonLayer) and the EXACT colors/mapping applied to the map? The reported colors and layer type in chat MUST 100% match what was passed in the map_style_layer tool call — ZERO COLOR HALLUCINATION.\n" +
  "\n" +
  "RESPONSE FORMAT RULES:\n" +
  "   - Multiple places found / Ambiguous locations → List the candidate places with city/state/country context and ALWAYS append `[OPTION: <place name>]` chips for each option so the user can click them directly in chat.\n" +
  "   - Multiple places found (search results) → Markdown TABLE with #, Name, Distance, Category.\n" +
  "   - Route/directions → Blockquote summary (distance, ETA, via). Inline code for road names.\n" +
  "   - Single location → Inline code for name+coords. Blockquote for full address.\n" +
  "   - Layer Styling & Colors (map_style_layer):\n" +
  "     * When map_style_layer has been applied, explicitly report the exact visualization type (e.g. GeoJsonLayer, HeatmapLayer, HexagonLayer, ScatterplotLayer, GridLayer) and the EXACT colors/mapping applied (e.g. '🎨 **Layer Styled**: Applied categorical styling with **#3b82f6 Blue** for South and **#ef4444 Red** for North', or 'Solid **#10b981 Emerald**').\n" +
  "     * ZERO HALLUCINATION MANDATE: Never say in chat a different color than what was passed into the map_style_layer tool call. The map and chat must be 100% deterministic.\n" +
  "   - PIN Code Comparison / LocusScore Results:\n" +
  "     * Present a clean Markdown COMPARISON TABLE with columns: Category | Why it Matters in India | Weight | PIN A Score (0-100) | PIN B Score (0-100) | Advantage / Delta.\n" +
  "     * Give the overall weighted LocusScores for both PIN codes prominently (e.g. 🏠 Real Estate: 560001: 84 | 560103: 61; or 🛒 FMCG: 560001: 90 | 560103: 61).\n" +
  "     * Explain distance-decay math: `AmenityValue = Σ [ 1 / (1 + distance_km / 0.5) ]` within a 1 km buffer zone. When rendering in chat, use KaTeX-compatible math blocks.\n" +
  "     * Add credibility calibration slide quote: 'These weights aren't arbitrary, and they get sharper as we ingest your data.'\n" +
  "     * If user didn't specify business sector, provide interactive chips to switch: [OPTION: Switch to FMCG / Retail] [OPTION: Switch to Quick-Commerce] [OPTION: Switch to Real Estate]\n" +
  "     * CRITICAL — 4-LAYER MAP VISUALIZATION & COLOR LEGEND EXPLANATION:\n" +
  "       Explain that 4 separate layers were added to the map and explain their colors clearly:\n" +
  "       1. Layer 1: Boundary for PIN A (polygon colored by score tier: 🟢 Deep Emerald 85+, 🟩 Green 70-84, 🟡 Amber 55-69, 🟠 Orange 40-54, 🔴 Red <40)\n" +
  "       2. Layer 2: Amenities for PIN A (dots colored by amenity category)\n" +
  "       3. Layer 3: Boundary for PIN B (polygon colored by score tier)\n" +
  "       4. Layer 4: Amenities for PIN B (dots colored by amenity category)\n" +
  "       Include a '🗺️ Map Layers & Color Legend' section detailing both boundary score colors and category dot colors (Healthcare=Emerald, Education=Indigo, Retail=Purple/Amber, Dining=Orange, Banking=Blue/Cyan, Transit=Violet/Cyan, Recreation=Lime, Civic=Rose)!\n" +
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
      execute: async (args: any) => {
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

        // ── LocusScore Live Computation for Multi-Agent Pipeline ──
        if (clientTool.name === "compare_pincodes_locus_score") {
          console.log(`\n================================================================================`);
          console.log(`🚀 [ADK AGENT] Executing Tool: compare_pincodes_locus_score`);
          console.log(`   Comparing PIN A: ${args.pinCodeA} VS PIN B: ${args.pinCodeB}`);
          console.log(`   Sector: ${args.sector || "real_estate"} | Distance Decay (d0): ${args.d0 ?? 0.5} km`);
          console.log(`   Specific Amenities Filter: ${args.specificAmenities ? JSON.stringify(args.specificAmenities) : "All 8 Categories"}`);
          console.log(`================================================================================`);
          try {
            const { fetchOrResolvePinCode, comparePinCodes, AMENITY_CATEGORIES, SECTOR_PROFILES, getScoreBasedBoundaryColor, generateComparisonColorLegend, generateZipBoundaryGeoJson, generatePinAmenitiesGeoJson } = await import("@/services/locusScoreService");
            const d0 = typeof args.d0 === "number" ? args.d0 : 0.5;
            const sector = (args.sector || "real_estate") as any;
            const requestedCategory = args.specificAmenities?.join(",") || sector;
            const dataA = await fetchOrResolvePinCode(args.pinCodeA, d0, requestedCategory);
            const dataB = await fetchOrResolvePinCode(args.pinCodeB, d0, requestedCategory);
            const comparison = comparePinCodes(dataA, dataB, sector, d0);

            const sectorLabel = (SECTOR_PROFILES as any)[sector]?.name || sector;

            // ═══════════════════════════════════════════════════════════════════
            // 4-LAYER PIPELINE for Zipcode/Pincode Comparison
            // ═══════════════════════════════════════════════════════════════════
            // Layer 1: Zipcode A boundary (score-colored polygon)
            // Layer 2: Amenities for Zipcode A (category-wise colored points)
            // Layer 3: Zipcode B boundary (score-colored polygon)
            // Layer 4: Amenities for Zipcode B (category-wise colored points)
            // ═══════════════════════════════════════════════════════════════════

            const scoreA = comparison.overallDelta.scoreA;
            const scoreB = comparison.overallDelta.scoreB;
            const colorA = getScoreBasedBoundaryColor(scoreA);
            const colorB = getScoreBasedBoundaryColor(scoreB);

            // ── LAYER 1: Zipcode A Boundary (score-based fill color) ──
            const boundaryGeoA = generateZipBoundaryGeoJson(dataA, scoreA, sectorLabel);
            _spatialBuffer.push({
              toolName: "compare_pincodes_locus_score",
              label: `Boundary: ${args.pinCodeA} (${dataA.name})`,
              geojson: boundaryGeoA,
              metadata: {
                featureCount: boundaryGeoA.features.length,
                summary: `Boundary for ${args.pinCodeA} (${dataA.name}) — Score ${scoreA}, Tier: ${colorA.tier}`,
              },
            });

            // ── LAYER 2: Amenities for Zipcode A (category-wise colored) ──
            const amenitiesGeoA = generatePinAmenitiesGeoJson(dataA, `pinA_${args.pinCodeA}`);
            _spatialBuffer.push({
              toolName: "compare_pincodes_locus_score",
              label: `Amenities: ${args.pinCodeA} (${dataA.name})`,
              geojson: amenitiesGeoA,
              metadata: {
                featureCount: amenitiesGeoA.features.length,
                summary: `${amenitiesGeoA.features.length} amenities inside boundary of ${args.pinCodeA} (${dataA.name})`,
              },
            });

            // ── LAYER 3: Zipcode B Boundary (score-based fill color) ──
            const boundaryGeoB = generateZipBoundaryGeoJson(dataB, scoreB, sectorLabel);
            _spatialBuffer.push({
              toolName: "compare_pincodes_locus_score",
              label: `Boundary: ${args.pinCodeB} (${dataB.name})`,
              geojson: boundaryGeoB,
              metadata: {
                featureCount: boundaryGeoB.features.length,
                summary: `Boundary for ${args.pinCodeB} (${dataB.name}) — Score ${scoreB}, Tier: ${colorB.tier}`,
              },
            });

            // ── LAYER 4: Amenities for Zipcode B (category-wise colored) ──
            const amenitiesGeoB = generatePinAmenitiesGeoJson(dataB, `pinB_${args.pinCodeB}`);
            _spatialBuffer.push({
              toolName: "compare_pincodes_locus_score",
              label: `Amenities: ${args.pinCodeB} (${dataB.name})`,
              geojson: amenitiesGeoB,
              metadata: {
                featureCount: amenitiesGeoB.features.length,
                summary: `${amenitiesGeoB.features.length} amenities inside boundary of ${args.pinCodeB} (${dataB.name})`,
              },
            });

            console.log(`\n================================================================================`);
            console.log(`🗺️ [STEP 6: 4-LAYER MAP PIPELINE CREATION]`);
            console.log(`   • Layer 1 (Boundary A): PIN ${args.pinCodeA} (${dataA.name}) -> Score ${scoreA}/100 [Tier: ${colorA.tier}, Color: ${colorA.label}]`);
            console.log(`   • Layer 2 (Amenities A): PIN ${args.pinCodeA} (${dataA.name}) -> ${amenitiesGeoA.features.length} POIs with category colors`);
            console.log(`   • Layer 3 (Boundary B): PIN ${args.pinCodeB} (${dataB.name}) -> Score ${scoreB}/100 [Tier: ${colorB.tier}, Color: ${colorB.label}]`);
            console.log(`   • Layer 4 (Amenities B): PIN ${args.pinCodeB} (${dataB.name}) -> ${amenitiesGeoB.features.length} POIs with category colors`);
            console.log(`   🎨 Category Dot Color Legend:`);
            console.log(`      - Education: Blue (#2563EB)`);
            console.log(`      - Healthcare: Red (#DC2626)`);
            console.log(`      - Daily Needs: Amber (#D97706)`);
            console.log(`      - Food & Beverage: Rose (#E11D48)`);
            console.log(`      - Banking & Finance: Green (#059669)`);
            console.log(`      - Transit & Connectivity: Violet (#7C3AED)`);
            console.log(`      - Recreation & Open Space: Emerald (#10B981)`);
            console.log(`      - Civic & Community: Sky (#0284C7)`);
            console.log(`   ✅ Queued all 4 layers to spatialDataBuffer for Deck.gl map.`);
            console.log(`================================================================================\n`);

            // Generate color legend for the verifying_agent to explain to user
            const colorLegend = generateComparisonColorLegend(dataA, dataB, scoreA, scoreB, sector);

            // Construct category breakdown summary for verifying_agent
            const categorySummary = Object.entries(comparison.categoryDeltas).map(([catId, catData]: [string, any]) => {
              const catConfig = (AMENITY_CATEGORIES as any)[catId];
              const profile = (SECTOR_PROFILES as any)[sector];
              const weightPct = (((profile?.weights as any)?.[catId] || 0) * 100).toFixed(0);
              return {
                category: catConfig?.label || catId,
                whyItMatters: catConfig?.whyItMatters || "",
                weight: `${weightPct}%`,
                scoreA: catData.scoreA,
                scoreB: catData.scoreB,
                diff: catData.diff > 0 ? `+${catData.diff} (${args.pinCodeA})` : catData.diff < 0 ? `+${Math.abs(catData.diff)} (${args.pinCodeB})` : "Equal",
                winner: catData.winner === "A" ? args.pinCodeA : catData.winner === "B" ? args.pinCodeB : "Tie"
              };
            });

            return {
              _type: "client_tool_call",
              toolName: clientTool.name,
              args: args,
              status: "success",
              pinCodeA: args.pinCodeA,
              nameA: dataA.name,
              cityA: dataA.city,
              overallScoreA: comparison.overallDelta.scoreA,
              boundaryColorA: colorA.label,
              pinCodeB: args.pinCodeB,
              nameB: dataB.name,
              cityB: dataB.city,
              overallScoreB: comparison.overallDelta.scoreB,
              boundaryColorB: colorB.label,
              winner: comparison.overallDelta.winner === "A" ? args.pinCodeA : comparison.overallDelta.winner === "B" ? args.pinCodeB : "Tie",
              sector: comparison.sector,
              sectorLabel,
              takeaways: comparison.narrativeTakeaways,
              categoryBreakdown: categorySummary,
              colorLegend,
              layerStructure: "4-layer pipeline: Layer 1 = Boundary of " + args.pinCodeA + " (score-colored), Layer 2 = Amenities of " + args.pinCodeA + " (category-colored), Layer 3 = Boundary of " + args.pinCodeB + " (score-colored), Layer 4 = Amenities of " + args.pinCodeB + " (category-colored)",
              message: `Successfully calculated LocusScore comparison for PIN ${args.pinCodeA} (${dataA.name}) and PIN ${args.pinCodeB} (${dataB.name}) under ${sectorLabel} sector profile via 4-layer pipeline. Scores: ${comparison.overallDelta.scoreA} vs ${comparison.overallDelta.scoreB}. 4 map layers queued: 2 boundary polygons (score-colored) + 2 amenity layers (category-colored).`,
            };
          } catch (e: any) {
            console.error("Error in compare_pincodes_locus_score execution:", e);
            return {
              _type: "client_tool_call",
              toolName: clientTool.name,
              args: args,
              status: "partial",
              message: `Queued comparison for ${args.pinCodeA} and ${args.pinCodeB} on map.`,
            };
          }
        }

        if (clientTool.name === "score_pincode_locus") {
          try {
            const { fetchOrResolvePinCode } = await import("@/services/locusScoreService");
            const d0 = typeof args.d0 === "number" ? args.d0 : 0.5;
            const sector = (args.sector || "real_estate") as any;
            const data = await fetchOrResolvePinCode(args.pinCode, d0, args.specificAmenities || args.category || sector);

            // Queue boundary polygon if available
            if (data.polygonCoordinates && data.polygonCoordinates.length > 0) {
              _spatialBuffer.push({
                toolName: "score_pincode_locus",
                label: `Boundary ${args.pinCode}`,
                geojson: {
                  type: "FeatureCollection",
                  features: [
                    {
                      type: "Feature",
                      geometry: {
                        type: "Polygon",
                        coordinates: [data.polygonCoordinates],
                      },
                      properties: {
                        pinCode: args.pinCode,
                        name: data.name,
                        city: data.city,
                        score: (data.sectorScores as any)[sector],
                        fillColor: [79, 70, 229, 50],
                        strokeColor: [79, 70, 229, 230],
                      },
                    },
                  ],
                },
                metadata: {
                  featureCount: 1,
                  summary: `Zipcode boundary polygon for ${args.pinCode}`,
                },
              });
            }

            // Queue POIs strictly inside the boundary
            if (data.pois && data.pois.length > 0) {
              _spatialBuffer.push({
                toolName: "score_pincode_locus",
                label: `Amenities: PIN ${args.pinCode}`,
                geojson: {
                  type: "FeatureCollection",
                  features: data.pois.map((poi) => {
                    const { category, color } = getAmenityCategoryAndColor(poi);
                    return {
                      type: "Feature",
                      geometry: {
                        type: "Point",
                        coordinates: [poi.lng, poi.lat],
                      },
                      properties: {
                        name: poi.name,
                        title: poi.name,
                        category,
                        amenity: poi.amenityTag,
                        distanceKm: poi.distanceKm,
                        decayWeight: poi.decayWeight,
                        address: poi.address,
                        fillColor: color,
                        color,
                        strokeColor: [255, 255, 255, 240],
                        lineColor: [255, 255, 255, 240],
                        pointRadius: 25,
                        radius: 25,
                      },
                    };
                  }),
                },
                metadata: {
                  featureCount: data.pois.length,
                  summary: `${data.pois.length} amenities strictly inside boundary of PIN ${args.pinCode}`,
                },
              });
            }

            return {
              _type: "client_tool_call",
              toolName: clientTool.name,
              args: args,
              status: "success",
              pinCode: args.pinCode,
              areaName: data.name,
              city: data.city,
              character: data.character,
              sectorScores: data.sectorScores,
              normalizedScores: data.normalizedScores,
              selectedSectorScore: (data.sectorScores as any)[sector],
              poiCounts: data.poiCounts,
              message: `Successfully scored PIN ${args.pinCode} (${data.name}) via 4-step pipeline (get_zip_data boundary -> get_osm_query -> run_osm_query amenities -> distance-decay scoring). Real Estate: ${data.sectorScores.real_estate}, FMCG/Retail: ${data.sectorScores.fmcg_retail}, Quick-Commerce: ${data.sectorScores.quick_commerce}.`,
            };
          } catch (e: any) {
            console.error("Error in score_pincode_locus execution:", e);
            return {
              _type: "client_tool_call",
              name: clientTool.name,
              args: args,
              status: "partial",
              message: `Queued scoring for ${args.pinCode} on map.`,
            };
          }
        }

        if (clientTool.name === "map_style_layer") {
          const style = args.style || {};
          const layerRef = args.layerId || (args.layerIndex !== undefined ? `layer #${args.layerIndex}` : "active layer");
          const candidateViz = args.visualizationType || style.visualizationType || style.type;
          const visType = candidateViz === "HeatmapLayer" || candidateViz === "heatmap"
            ? "HeatmapLayer"
            : candidateViz === "HexagonLayer" || candidateViz === "hexagon"
              ? "HexagonLayer"
              : candidateViz === "ScatterplotLayer" || candidateViz === "scatterplot"
                ? "ScatterplotLayer"
                : candidateViz === "GridLayer" || candidateViz === "grid"
                  ? "GridLayer"
                  : "GeoJsonLayer";
          return {
            _type: "client_tool_call",
            name: clientTool.name,
            args: args,
            appliedLayer: layerRef,
            visualizationType: visType,
            styleType: style.type || "solid",
            appliedColors: {
              fillColor: style.fillColor || null,
              lineColor: style.lineColor || null,
              mapping: style.mapping || null,
              minColor: style.minColor || null,
              maxColor: style.maxColor || null,
              colorRange: style.colorRange || null,
              palette: style.palette || null,
            },
            message: `Successfully applied deterministic style to ${layerRef}. Visualization: ${visType}. Style: ${style.type || "solid"}. The Deck.gl layer rendered with these exact colors on the map. You MUST report these EXACT colors and layer type in your response to the user.`,
          };
        }

        if (clientTool.name === "map_clear_layer_style") {
          const layerRef = args.layerId || (args.layerIndex !== undefined ? `layer #${args.layerIndex}` : "active layer");
          return {
            _type: "client_tool_call",
            name: clientTool.name,
            args: args,
            appliedLayer: layerRef,
            message: `Successfully cleared custom styling for ${layerRef}. Reverted to default styling.`,
          };
        }

        if (clientTool.name === "run_client_duckdb_query") {
          const queryText = args.queryText || args.query || args.sql || args.sqlQuery || args.query_text || "";
          return {
            _type: "client_tool_call",
            name: clientTool.name,
            args: {
              ...args,
              queryText,
            },
            message: `Scheduled client DuckDB query on map layer: "${queryText ? queryText.substring(0, 80) : "active layer"}". Results will appear in the Query Results Panel.`,
          };
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

  const mapUiClientTools = adkClientTools;

  // 2. Set up the Mapbox MCP Toolset (filtering out Claude Desktop iframe UI tools)
  console.log(`[Mapbox MCP] Query: "${userPrompt || "none"}"`);
  console.log(
    `[Mapbox MCP] Loading Mapbox spatial tools (excluding UI render tools)`,
  );

  class FilteredMapboxMCPToolset extends MCPToolset {
    private disallowed = new Set(["render_map_tool", "static_map_image_tool"]);

    override async getTools(context?: any) {
      try {
        const tools = await super.getTools(context);
        return tools.filter((t: any) => !this.disallowed.has(t.name));
      } catch (err: any) {
        console.warn("⚠️ [ADK Agent] Failed to load Mapbox MCP tools:", err?.message || err);
        return [];
      }
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
  class SafeDuckDbPlaygMCPToolset extends MCPToolset {
    override async getTools(context?: any) {
      try {
        const tools = await super.getTools(context);
        return tools;
      } catch (err: any) {
        console.warn("⚠️ [ADK Agent] Failed to load Playg MCP tools for DuckDB:", err?.message || err);
        return [];
      }
    }
  }

  const playgMcpToolset = new SafeDuckDbPlaygMCPToolset({
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
        INSTANCE_PATH: process.env.DUCKDB_INSTANCE_PATH || ":memory:",
        FILE_PATH: "",
      } as Record<string, string>,
    },
  });

  // Filtered Playg toolset for playground_agent (removes run_duck_db_queries so it never attempts backend SQL)
  class FilteredPlaygMCPToolset extends MCPToolset {
    private disallowed = new Set(["run_duck_db_queries"]);

    override async getTools(context?: any) {
      try {
        const tools = await super.getTools(context);
        return tools.filter((t: any) => !this.disallowed.has(t.name));
      } catch (err: any) {
        console.warn("⚠️ [ADK Agent] Failed to load Playg MCP tools for Playground:", err?.message || err);
        return [];
      }
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
        INSTANCE_PATH: process.env.DUCKDB_INSTANCE_PATH || ":memory:",
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
      let rawParsed = extracted.rawParsed;

      // Handle async fetch cases (Response_URL, mapbox:// URI, HTTP URL)
      if (!normalized && rawParsed?._needsFetch && rawParsed?._responseUrl) {
        console.log(`  ↳ Fetching Response_URL: ${rawParsed._responseUrl}`);
        try {
          const fetchRes = await fetch(rawParsed._responseUrl);
          let jsonData = await fetchRes.json();
          if (typeof jsonData === "string") {
            try {
              jsonData = JSON.parse(jsonData);
            } catch {}
          }
          const { normalizeToGeoJSON } =
            await import("@/utils/spatialNormalizer");
          normalized = normalizeToGeoJSON(jsonData, toolName);
          if (jsonData) {
            rawParsed = jsonData;
          }
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

      // Track active boundary in BoundaryClipper
      if ((toolName === "get_zip_data" || toolName === "get_district_data") && normalized?.features?.length > 0) {
        const { setActiveBoundary } = await import("./utils/boundaryClipper");
        const pinCodeVal = params.args?.value || params.args?.zipcode;
        const pinHint = typeof pinCodeVal === "string" ? pinCodeVal.replace(/\D/g, "") : undefined;
        setActiveBoundary(normalized, pinHint, toolName);
      }

      // For run_osm_query: strictly clip POIs by boundary polygon
      let osmOutsideCount = 0;
      if (toolName === "run_osm_query") {
        const { getActiveBoundary, clipFeaturesStrictlyToBoundary } = await import("./utils/boundaryClipper");
        
        let pinCodeHint: string | undefined;
        const promptPinMatch = userPrompt?.match(/\b[1-9][0-9]{5}\b/);
        if (promptPinMatch) pinCodeHint = promptPinMatch[0];

        const activeBoundary = await getActiveBoundary(pinCodeHint);
        if (activeBoundary && normalized?.features) {
          const clipResult = clipFeaturesStrictlyToBoundary(
            normalized.features,
            activeBoundary,
            pinCodeHint
          );
          normalized.features = clipResult.inside;
          osmOutsideCount = clipResult.outsideCount;
        }

        // If no features are inside the boundary, return handled response so fallback never adds external points!
        if (!normalized?.features || normalized.features.length === 0) {
          console.log(`🎯 [Spatial Interceptor] 0 features inside boundary for run_osm_query (${osmOutsideCount} external points discarded).`);
          return {
            content: [
              {
                type: "text",
                text: `✅ 0 amenities found strictly inside the zipcode boundary (${osmOutsideCount} external amenities located outside the polygon boundary were filtered out).`,
              },
            ],
            _spatialDataExtracted: true,
          };
        }
      }

      let suffix = Math.random().toString(36).slice(2, 6);
      if (params.args) {
        if (Array.isArray(params.args.amenities) && params.args.amenities.length > 0) {
          suffix = String(params.args.amenities[0]).replace(/[^\w]/g, "_");
        } else {
          const val = Object.values(params.args)[0];
          if (typeof val === "string") {
            suffix = val.substring(0, 20);
          }
        }
      }
      let uniqueLabel = `${toolName}_${suffix}`;
      if (toolName === "run_osm_query") {
        try {
          const { getActiveBoundary } = await import("./utils/boundaryClipper");
          let pinCodeHint: string | undefined;
          const promptPinMatch = userPrompt?.match(/\b[1-9][0-9]{5}\b/);
          if (promptPinMatch) pinCodeHint = promptPinMatch[0];
          const activeBoundary = await getActiveBoundary(pinCodeHint);
          const pin = activeBoundary?.pinCode || pinCodeHint;
          if (pin) {
            uniqueLabel = `Amenities (PIN ${pin})`;
          } else if (activeBoundary?.name) {
            uniqueLabel = `Amenities (${activeBoundary.name})`;
          }
        } catch {}
      }

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
        if (toolName === "get_zip_data" || toolName === "get_district_data") {
          try {
            const { getActiveBoundary } = await import("./utils/boundaryClipper");
            const boundaryMeta = await getActiveBoundary();
            if (boundaryMeta) {
              metadata.centroid = boundaryMeta.centroid;
              metadata.boundingRadiusMeters = boundaryMeta.boundingRadiusMeters;
            }
          } catch {}
        }
        let summary = createLightweightSummary(toolName, metadata, rawParsed);
        if (toolName === "run_osm_query") {
          summary = `✅ Found ${normalized.features.length} amenities strictly inside the boundary (${osmOutsideCount} external points filtered out). All ${normalized.features.length} inside amenities have been rendered on the map.`;
        }

        console.log(
          `  ✅ Intercepted ${normalized.features.length} features from ${toolName}. LLM gets summary only.`,
        );

        // Store in shared buffer for route.ts to read
        // If an amenities layer for this label already exists in _spatialBuffer, merge features into it!
        const existingAmenityBufferIndex = _spatialBuffer.findIndex(
          (b) => b.label === uniqueLabel && b.geojson?.features
        );

        if (existingAmenityBufferIndex !== -1) {
          const target = _spatialBuffer[existingAmenityBufferIndex];
          const seen = new Set(
            target.geojson.features.map(
              (f: any) => `${f.properties?.name || ""}_${f.geometry?.coordinates?.join(",")}`
            )
          );
          const newToAdd = normalized.features.filter((f: any) => {
            const key = `${f.properties?.name || ""}_${f.geometry?.coordinates?.join(",")}`;
            return !seen.has(key);
          });
          target.geojson.features.push(...newToAdd);
          target.metadata.featureCount = target.geojson.features.length;
          console.log(
            `📦 [Spatial Interceptor] Merged ${newToAdd.length} features into existing layer "${uniqueLabel}" (Total: ${target.geojson.features.length}).`
          );
        } else {
          _spatialBuffer.push({
            toolName,
            label: uniqueLabel,
            geojson: normalized,
            metadata,
          });
        }

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
      "LocusScore & Map UI specialist: Computes PIN / ZIP code Location Intelligence & Livability scores across 8 OSM categories (Education, Healthcare, Daily Needs, F&B, Banking, Transit, Recreation, Civic) for Real Estate, FMCG / Retail, and Quick-Commerce via score_pincode_locus and compare_pincodes_locus_score, and controls map display (fly_to, zoom, draw, markers, layers, styles).",
    instruction: `You are the Map UI & LocusScore specialist. You calculate PIN code location intelligence (compare_pincodes_locus_score, score_pincode_locus) and execute map display actions using client-side tools.

${MAP_UI_AGENT_SKILL}

AGENT BOUNDARY (CRITICAL — VIOLATION CAUSES SYSTEM CRASH):
- You do NOT have access to Mapbox MCP tools (search_and_geocode_tool, directions_tool, distance_tool, category_search_tool, etc.).
- You do NOT have access to Playground tools (get_zip_data, get_osm_query, run_osm_query, run_duck_db_queries, get_user_layers). You have access to all client-side map tools and run_client_duckdb_query for in-browser SQL filtering and layer styling.
- NEVER attempt to call tools you don't have. If you need spatial data or geocoded coordinates, return what's missing in your summary. The planner will route to the correct data agent.
- If you accidentally try to call a tool you don't own, the system will crash with an error. This is YOUR fault — avoid it.

EXECUTION RULES:
- If asked to compare two PIN codes: call compare_pincodes_locus_score(pinCodeA, pinCodeB, sector, specificAmenities).
- If asked to score a single PIN code or find amenities in a PIN code: call score_pincode_locus(pinCode, sector, specificAmenities).
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

LOCUSSCORE & PIN CODE INTELLIGENCE RULES (CRITICAL):
- LocusScore tools ('score_pincode_locus' for a single PIN, 'compare_pincodes_locus_score' for two PINs) belong EXCLUSIVELY to map_ui_agent (NOT playground_agent, NOT duckdb_agent).
- When map_ui_agent has called 'compare_pincodes_locus_score' or 'score_pincode_locus', the data calculation and map layer rendering are COMPLETE!
- In your final response, explicitly highlight the 4-step pipeline executed:
  1. Boundary & Centroid: Fetched via get_zip_data
  2. OSM Query Template: Resolved via get_osm_query
  3. Real Amenities Dataset: Fetched via run_osm_query for the requested categories/amenities
  4. LocusScore Calculation: Distance-decay formula: AmenityValue = Σ [ 1 / (1 + distance_km / 0.5) ] across the 8 categories, and weighted across Real Estate, FMCG/Retail, and Quick-Commerce.
- You MUST write the complete, final Markdown response directly to the user:
  * For comparison: Markdown comparison table (8 categories with weights, scores, deltas), overall scores, distance-decay explanation, calibration quote, and interactive [OPTION: ...] chips.
    CRITICAL: You MUST include a dedicated "🗺️ Map Layers & Color Legend" section explaining the 4 layers plotted on the map and their exact color coding:
    - Layer 1: Boundary for PIN A (polygon colored by score tier)
    - Layer 2: Amenities for PIN A (points colored by amenity category)
    - Layer 3: Boundary for PIN B (polygon colored by score tier)
    - Layer 4: Amenities for PIN B (points colored by amenity category)
    - Clearly explain each boundary color and amenity category dot color so the user understands the map visuals at a glance!
  * For single PIN score: Overall sector score, category breakdown table, distance-decay formula note, calibration quote, and comparison option chips.
- If the user asked for PIN comparison or PIN scoring and NO tool has run yet:
  * If two PIN codes are present: report "INCOMPLETE: Need map_ui_agent to call compare_pincodes_locus_score."
  * If one PIN code is present: report "INCOMPLETE: Need map_ui_agent to call score_pincode_locus."
  * If no PIN codes were provided (e.g. "compare pincodes"): respond directly to the user asking which two PIN codes and sector to compare, with clickable [OPTION: ...] chips.
- NEVER blame playground_agent or duckdb_agent for PIN scoring. They do not own LocusScore.

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
- 'map_ui_agent':
  * CRITICAL — LOCUSSCORE & PIN INTELLIGENCE: Handles ALL PIN code scoring, location scores, and dual PIN/ZIP comparisons (score_pincode_locus, compare_pincodes_locus_score). When the user asks about ANY PIN code score (e.g. 560001), PIN comparison (e.g. 560001 vs 560103), or LocusScore: ALWAYS transfer to 'map_ui_agent' FIRST! NEVER transfer directly to verifying_agent without first transferring to map_ui_agent!
  * Map display actions: fly_to, zoom, draw shapes, add markers, load GeoJSON/URLs, clear map, change base map, rotate, style layer.
- 'mapbox_agent': Search places, geocoding, directions, isochrones, category search, distance, geometric ops — anything geographic/spatial.
- 'playground_agent': Zip boundary data, user layers, OSM queries — anything platform/Playground (NOT PIN scoring or LocusScore).
- 'duckdb_agent': Analyze datasets, files (Parquet, CSV, GeoJSON, Shapefile), URLs, map layers, or existing DuckDB tables using SQL queries. Automatically uses client-side DuckDB (run_client_duckdb_query) for most queries (including heavy/complex analysis if intended by user) on visible map layers, or backend (run_duck_db_queries) for backend-specific remote analysis.

MAP UI TOOL ROUTING (MEMORIZE THIS):
These tools belong EXCLUSIVELY to map_ui_agent. NEVER route these to mapbox_agent, playground_agent, or duckdb_agent:
→ compare_pincodes_locus_score, score_pincode_locus
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
- Failed tool is score_pincode_locus or compare_pincodes_locus_score → Route to map_ui_agent
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

Map/data/SQL includes: search, directions, zoom, draw, zip data, PIN code scoring, PIN code comparison, LocusScore, location score, neighbourhood livability, show on map, clear map, base map, SQL queries, layer analysis, area calculations, [SELECTED_MAP_LAYERS], [MAP_SQL_CONTEXT], and ALL follow-up requests like "ab isko map pe dikhao", "zoom in karo", "search another place", "clear karo".
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
