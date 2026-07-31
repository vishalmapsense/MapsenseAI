import { LlmAgent, MCPToolset, FunctionTool, Gemini } from "@google/adk";
import { ALL_CLIENT_TOOLS } from "@/config/clientTools";
import { convertParametersToZod } from "./utils/zodMapper";
import { MAPBOX_MCP_CONFIG } from "@/config/mcp.config";
import { getDynamicTools } from "./utils/dynamicToolFilter";

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

export function createADKAgent(apiKey?: string, userPrompt?: string) {
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
    // Filter down Mapbox tools to reduce token usage
    userPrompt ? getDynamicTools(userPrompt) : [
      "search_and_geocode_tool",
      "reverse_geocode_tool",
      "isochrone_tool",
      "directions_tool",
      "category_search_tool",
      "ground_location_tool"
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
        BEARER_TOKEN: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImQ1ZGNlZmMxLWQ4ZjQtNDBmOC1iN2YxLWE2Mjc5YjhmNzkyNiIsImVtYWlsIjoiYWRtaW5AZW1haWwuY29tIiwib3JnYW5pemF0aW9uSWQiOiJmNmM2NjIzZS0xMWM3LTQzNTktOGJmMS05Zjg5YmQ4NjdjNWUiLCJvcmdhbml6YXRpb24iOiJQbGF0Zm9ybSBBZG1pbiIsInJvbGUiOiJTVVBFUl9BRE1JTiIsImlhdCI6MTc4NTIyNTc5Nn0.IdBtlbb2WbxtGcnGFYGwVqmHkZMR2BgKVsRjiE06Vig",
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
    description: "Handles geocoding, place search, and fetching Mapbox spatial data.",
    instruction: `You search for places, geocode locations, and fetch spatial data using Mapbox MCP tools.
Return a clear text summary and any geographic data found. DO NOT transfer to any other agent.
${LANG_RULE}
${HITL_RULE}`,
    tools: [mapboxMcpToolset],
  });

  // ─── Sub-Agent 2: Playground Agent (Playg MCP Tools) ───────────
  const playgroundAgent = new LlmAgent({
    model: modelToUse,
    name: "playground_agent",
    description: "Handles Playground specific tools and data.",
    instruction: `You use Playground MCP tools to fetch or manipulate data.
Return a clear text summary and any geographic data found. DO NOT transfer to any other agent.
${LANG_RULE}
${HITL_RULE}`,
    tools: [playgMcpToolset],
  });

  // ─── Sub-Agent 3: Data Agent (Data Router) ───────────
  const dataAgent = new LlmAgent({
    model: modelToUse,
    name: "data_agent",
    description: "Router for fetching spatial or location data from various MCP servers (Mapbox, Playground).",
    instruction: `You route data requests to the appropriate specialized data agent.
- If it's a general map search, directions, or Mapbox data -> transfer to 'mapbox_agent'.
- If it's Playground specific data -> transfer to 'playground_agent'.
After the sub-agent returns, summarize the result. DO NOT transfer to 'map_ui_agent' yourself.
${LANG_RULE}
${HITL_RULE}`,
    subAgents: [mapboxAgent, playgroundAgent],
  });

  // ─── Sub-Agent 4: Map UI Agent ────────────────────────────────
  const mapUiAgent = new LlmAgent({
    model: modelToUse,
    name: "map_ui_agent",
    description: "Executes map actions like flying, zooming, drawing, and loading data URLs on the client map.",
    instruction: `You execute map UI actions (fly_to, zoom, draw, markers, map_load_url, etc.) using client tools.
You will receive coordinates, spatial data URLs, and context from the conversation history.
Use the appropriate map tool with the correct arguments (lat, lng, zoom, url, etc.). If a previous agent provided a URL to draw, use the 'map_load_url' tool.
After your tool call succeeds, DO NOT transfer to any other agent. Instead, just write a clear, friendly, well-formatted text response summarizing what was done.
If a tool call fails, try again with corrected arguments (max 2 retries).
${LANG_RULE}
${HITL_RULE}`,
    tools: adkClientTools,
  });

  // ─── Sub-Agent 5: Planner Agent ────────────────────────────────
  const plannerAgent = new LlmAgent({
    model: modelToUse,
    name: "planner_agent",
    description: "Decides which tools are needed and delegates tasks to either data_agent or map_ui_agent.",
    instruction: `You are the Planner. You determine the execution path based on the user's query.
1. If the user wants to search for a place, get directions, or fetch geographic data -> transfer to 'data_agent'.
2. If the user wants a map UI action (fly, zoom, draw) or to render data -> transfer to 'map_ui_agent'.
3. If the task requires BOTH data fetching and UI updating, you must orchestrate them sequentially (e.g., call 'data_agent' first, then 'map_ui_agent').
${LANG_RULE}
${HITL_RULE}`,
    subAgents: [dataAgent, mapUiAgent],
  });

  // ─── Root Agent (Orchestrator) ────────────────────────────────
  const rootAgent = new LlmAgent({
    model: modelToUse,
    name: "root_agent",
    description: "Main orchestrator that answers general questions or delegates to the planner agent.",
    instruction: `You are Mapsense AI. 
1. If the user asks a general question (e.g., "how are you?", "what can you do?", or simple conversational chatter) -> Answer it directly yourself.
2. If the user asks for anything related to the map, searching places, drawing, or data analysis -> transfer to 'planner_agent'.

If the conversation history shows that an agent has already completed the task, stop immediately and do not transfer again.
${LANG_RULE}
${HITL_RULE}`,
    subAgents: [plannerAgent],
  });

  return { rootAgent, mapboxMcpToolset, playgMcpToolset };
}
