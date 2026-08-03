import { LlmAgent, MCPToolset, FunctionTool, Gemini } from "@google/adk";
import { ALL_CLIENT_TOOLS } from "@/config/clientTools";
import { convertParametersToZod } from "./utils/zodMapper";
import { MAPBOX_MCP_CONFIG } from "@/config/mcp.config";
import { getAISelectedTools, getDynamicTools } from "./utils/dynamicToolFilter";

// Shared language constraint for all agents
const LANG_RULE =
  "IMPORTANT: You MUST communicate with the user in their preferred language. Prefer using Hinglish, Hindi, or English. If the user communicates in a specific local language, respond in that local language.";
const HITL_RULE =
  "HUMAN IN THE LOOP (HITL) & AMBIGUITY HANDLING:\n" +
  "- If the user prompt is ambiguous (e.g. multiple locations with the same name, ambiguous request) OR if critical parameter data is missing, DO NOT guess or assume.\n" +
  "- If you need explicit permission or input from the user before executing a major tool action, STOP tool execution immediately.\n" +
  "- When offering countable options to the user, format each choice on its own line like `[OPTION: Option Text]` (e.g. `[OPTION: Paris, France]` or `[OPTION: Paris, Texas, USA]`). This enables interactive confirmation buttons in the chat.\n" +
  "- Write a message directly asking the user for the missing details or permission.\n" +
  "- When the user replies (or clicks an option button), workflow execution will resume from this exact step using session history.";

export async function createADKAgent(apiKey?: string, userPrompt?: string) {
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

  // 2. Set up the Mapbox MCP Toolset
  const mapboxMcpToolset = new MCPToolset(
    {
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
    },
    // AI-powered tool selection: LLM reads tool catalog and picks relevant tools
    userPrompt
      ? await getAISelectedTools(userPrompt, apiKey)
      : [
          "search_and_geocode_tool",
          "reverse_geocode_tool",
          "isochrone_tool",
          "directions_tool",
          "category_search_tool",
          "ground_location_tool",
        ]
  );

  // 3. Set up the Playg MCP Toolset
  const playgMcpToolset = new MCPToolset({
    type: "StdioConnectionParams",
    serverParams: {
      command: "node",
      args: ["/Users/vishalkushwaha/Mapsense/MapsenseAI/playg-mcp-server/build/index.js"],
      env: {
        ...process.env,
        PLAYG_API_BASE: "http://localhost:8000",
        USER_AGENT: "playg-mcp-server/1.0",
        REDIS_URL: "redis://localhost:6379",
        BEARER_TOKEN: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImQ1ZGNlZmMxLWQ4ZjQtNDBmOC1iN2YxLWE2Mjc5YjhmNzkyNiIsImVtYWlsIjoiYWRtaW5AZW1haWwuY29tIiwib3JnYW5pemF0aW9uSWQiOiJmNmM2NjIzZS0xMWM3LTQzNTktOGJmMS05Zjg5YmQ4NjdjNWUiLCJvcmdhbml6YXRpb24iOiJQbGF0Zm9ybSBBZG1pbiIsInJvbGUiOiJTVVBFUl9BRE1JTiIsImlhdCI6MTc4NTcwNTg3N30.eSXBYQ-yAfPqdWVfNxS8Y8AR9uMA5VlGX3j_k0elnik",
        INSTANCE_PATH: "",
        FILE_PATH: ""
      } as Record<string, string>,
    },
  });

  const modelToUse = apiKey
    ? new Gemini({ model: "gemini-3.1-flash-lite", apiKey })
    : "gemini-3.1-flash-lite";

  // ─── Sub-Agent 1: Mapbox Agent (Mapbox MCP Tools) ───────────
  const mapboxAgent = new LlmAgent({
    model: modelToUse,
    name: "mapbox_agent",
    description: "Handles geocoding, place search, directions, isochrones, and all Mapbox spatial data.",
    instruction: `You search for places, geocode locations, and fetch spatial data using Mapbox MCP tools.
Execute the requested tool(s) and return a clear technical summary with all geographic data found.
CRITICAL RULE: If a tool returns a URI, URL, or data reference (e.g. Response_URL) for spatial data, DO NOT try to fetch, query, or read it yourself. Simply return the URL reference as it is to the parent (backend function).
DO NOT generate a final user-facing response. DO NOT transfer to any other agent.
When you are DONE, simply return your summary — control will automatically go back to your parent agent.
${LANG_RULE}
${HITL_RULE}`,
    tools: [mapboxMcpToolset],
  });

  // ─── Sub-Agent 2: Playground Agent (Playg MCP Tools) ───────────
  const playgroundAgent = new LlmAgent({
    model: modelToUse,
    name: "playground_agent",
    description: "Handles Playground-specific tools: zip boundary data, DuckDB queries, instance/file operations.",
    instruction: `You use Playground MCP tools to fetch or manipulate data.
Execute the requested tool(s) and return a clear technical summary with all data found.
CRITICAL RULE: If a tool returns a URI, URL, or data reference (e.g. Response_URL) for spatial data, DO NOT try to fetch, query, or read it yourself (e.g., do not use DuckDB on it). Simply return the URL reference as it is to the parent (backend function).
DO NOT generate a final user-facing response. DO NOT transfer to any other agent.
When you are DONE, simply return your summary — control will automatically go back to your parent agent.
${LANG_RULE}
${HITL_RULE}`,
    tools: [playgMcpToolset],
  });

  // ─── Sub-Agent 3: Map UI Agent ────────────────────────────────
  const mapUiAgent = new LlmAgent({
    model: modelToUse,
    name: "map_ui_agent",
    description: "Executes map UI actions: fly_to, zoom, draw, markers, map_load_url, add_geojson, clear map.",
    instruction: `You execute map UI actions (fly_to, zoom, draw, markers, map_load_url, etc.) using client tools.
You will receive coordinates, spatial data URLs, and context from the conversation history.
Use the appropriate map tool with the correct arguments (lat, lng, zoom, url, etc.). If a previous agent provided a URL to draw, use the 'map_load_url' tool.
After your tool call succeeds, return a concise technical summary of the actions performed.
DO NOT transfer to any other agent. DO NOT generate a final user-facing response.
If a tool call fails, try again with corrected arguments (max 2 retries).
${LANG_RULE}
${HITL_RULE}`,
    tools: adkClientTools,
  });

  // ─── Sub-Agent 4: Verifying Agent ────────────────────────────────
  // Sits alongside work agents under planner. Has NO tools or sub-agents.
  // Its only job: check if work is complete and write final response.
  const verifyingAgent = new LlmAgent({
    model: modelToUse,
    name: "verifying_agent",
    description: "Checks if all parts of the user's request were completed. Writes the final user response if done, or reports what is still pending.",
    instruction: `You are the Verifying Agent. You are called by planner_agent AFTER work agents have finished.

YOUR JOB:
1. Read the user's LATEST request from the conversation history.
2. Read the summaries returned by work agents (mapbox_agent, playground_agent, map_ui_agent).
3. Check: were ALL parts of the user's request successfully completed?

IF EVERYTHING IS COMPLETE:
- Write a final, friendly, well-formatted response directly to the user summarizing what was done.
- You are the ONLY agent that should produce user-facing text.

IF SOMETHING IS MISSING OR FAILED:
- Return a technical message starting with "INCOMPLETE:" followed by exactly what is still pending.
  Example: "INCOMPLETE: Data was fetched but not displayed on the map. Need map_ui_agent to fly_to and add markers."
  Example: "INCOMPLETE: Search returned results but user also asked to zoom in. Need map_ui_agent to zoom."
- Do NOT try to fix it yourself. Planner will read your message and route to the right agent.

DO NOT call any tools. DO NOT transfer to any agent. Just analyze and respond.
${LANG_RULE}
${HITL_RULE}`,
  });

  // ─── Sub-Agent 5: Planner Agent ────────────────────────────────
  // Main orchestrator: routes to correct work agent, then asks verifying to check.
  const plannerAgent = new LlmAgent({
    model: modelToUse,
    name: "planner_agent",
    description: "Routes queries to the correct agent, then asks verifying_agent to confirm completion.",
    instruction: `You are the Planner — the main orchestrator of all map/data work.

STEP 1 — ROUTE TO THE RIGHT WORK AGENT:
Read the user's LATEST message and transfer to the correct agent:
- 'mapbox_agent': Search places, geocoding, directions, isochrones, category search, distance — anything Mapbox.
- 'playground_agent': Zip boundary data, DuckDB queries, instance/file operations — anything Playground.
- 'map_ui_agent': Fly to location, zoom, draw shapes, add markers, load GeoJSON/URLs, clear map — any map display action.

STEP 2 — VERIFY COMPLETION:
After the work agent returns its summary, ALWAYS transfer to 'verifying_agent' to check if the work is complete.

STEP 3 — HANDLE INCOMPLETE WORK:
If verifying_agent responds with "INCOMPLETE: ...", read what's missing and route to the correct work agent to fix it. Then send back to verifying_agent again.
Repeat until verifying_agent confirms everything is done.

CRITICAL ROUTING RULES:
- EVERY query gets FRESH routing. Do NOT reuse the agent from the previous turn.
- If a task needs BOTH data AND map display, do them sequentially: data first, then map display, then verify.
- DO NOT write any user-facing text yourself. Only verifying_agent writes the final response.

FOLLOW-UP EXAMPLES:
- Turn 1: "Search Delhi" → mapbox_agent → verifying_agent
- Turn 2: "Ab zoom karo" → map_ui_agent (NOT mapbox!) → verifying_agent
- Turn 1: "Get zip 208002" → playground_agent → verifying_agent
- Turn 2: "Show restaurants nearby" → mapbox_agent (NOT playground!) → verifying_agent
${LANG_RULE}
${HITL_RULE}`,
    subAgents: [mapboxAgent, playgroundAgent, mapUiAgent, verifyingAgent],
  });

  // ─── Root Agent (Entry Point) ────────────────────────────────
  const rootAgent = new LlmAgent({
    model: modelToUse,
    name: "root_agent",
    description: "Main entry point — handles general chat or delegates map/data work to planner.",
    instruction: `You are Mapsense AI — a smart map assistant.

ROUTING — follow these rules for EVERY message:
1. GENERAL CHAT (greetings, "what can you do?", jokes, chitchat) → Answer directly yourself.
2. ANYTHING MAP/DATA RELATED → Transfer to 'planner_agent' IMMEDIATELY. Do not answer yourself.

Map/data includes: search, directions, zoom, draw, zip data, show on map, clear map, and ALL follow-up requests like "ab isko map pe dikhao", "zoom in karo", "search another place", "clear karo".
${LANG_RULE}
${HITL_RULE}`,
    subAgents: [plannerAgent],
  });

  return { rootAgent, mapboxMcpToolset, playgMcpToolset };
}

