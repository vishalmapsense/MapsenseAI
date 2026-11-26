import { PLAYG_MCP_CONFIG } from "@/config/mcp.config";
import { extractPlaygResponseUrl } from "@/agents/utils/spatialDataInterceptor";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let playgMcpClient: Client | null = (globalThis as any)._playgMcpClient || null;
let cachedPlaygTools: any = (globalThis as any)._playgMcpTools || null;

async function getPlaygMcpClient(): Promise<Client> {
  if (playgMcpClient) {
    try {
      await playgMcpClient.listTools();
      return playgMcpClient;
    } catch (err) {
      console.warn("[Playg MCP] Stale connection detected, reconnecting...");
      playgMcpClient = null;
      (globalThis as any)._playgMcpClient = null;
      (globalThis as any)._playgMcpTools = null;
      cachedPlaygTools = null;
    }
  }

  const hostedUrl = process.env.PLAYG_MCP_URL ?? PLAYG_MCP_CONFIG.hostedUrl;
  const scriptPath =
    process.env.PLAYG_MCP_SCRIPT_PATH || PLAYG_MCP_CONFIG.serverScriptPath;
  const bearerToken =
    process.env.PLAYG_BEARER_TOKEN ||
    process.env.BEARER_TOKEN ||
    PLAYG_MCP_CONFIG.bearerToken;

  // 1. Try Hosted Endpoint first (https://playg-mcp-server.vercel.app/)
  if (hostedUrl) {
    try {
      console.log(`[Playg MCP] Attempting connection to hosted endpoint: ${hostedUrl}`);
      const httpTransport = new StreamableHTTPClientTransport(
        new URL(hostedUrl),
        {
          requestInit: {
            headers: {
              Accept: "application/json, text/event-stream",
              "Content-Type": "application/json",
              ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
            },
          },
        }
      );

      const client = new Client(
        { name: "mapsense-playg", version: "1.0.0" },
        { capabilities: {} }
      );

      await client.connect(httpTransport);
      const tools = await client.listTools();
      if (tools?.tools && tools.tools.length > 0) {
        console.log(`✅ [Playg MCP] Connected to hosted endpoint! (${tools.tools.length} tools)`);
        playgMcpClient = client;
        (globalThis as any)._playgMcpClient = playgMcpClient;
        return playgMcpClient;
      }
    } catch (httpErr: any) {
      console.warn(
        `⚠️ [Playg MCP] Hosted endpoint connection failed (${httpErr?.message || httpErr}). Falling back to stdio...`
      );
    }
  }

  // 2. Fallback to local stdio process if PLAYG_MCP_SCRIPT_PATH is configured
  if (!scriptPath) {
    throw new Error(
      "Playg MCP hosted endpoint failed and PLAYG_MCP_SCRIPT_PATH is not configured."
    );
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [scriptPath],
    env: {
      ...process.env,
      PLAYG_API_BASE: process.env.PLAYG_API_BASE || PLAYG_MCP_CONFIG.apiBase,
      USER_AGENT: process.env.PLAYG_USER_AGENT || "playg-mcp-server/1.0",
      REDIS_URL:
        process.env.PLAYG_REDIS_URL ||
        process.env.REDIS_URL ||
        PLAYG_MCP_CONFIG.redisUrl,
      BEARER_TOKEN: bearerToken,
      INSTANCE_PATH: process.env.DUCKDB_INSTANCE_PATH || ":memory:",
      FILE_PATH: "",
    },
  });

  const client = new Client(
    { name: "mapsense-playg", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  playgMcpClient = client;
  (globalThis as any)._playgMcpClient = playgMcpClient;

  return playgMcpClient;
}

export async function getPlaygTools(): Promise<any> {
  try {
    if (cachedPlaygTools) return cachedPlaygTools;
    const client = await getPlaygMcpClient();
    const result = await client.listTools();
    cachedPlaygTools = result;
    (globalThis as any)._playgMcpTools = cachedPlaygTools;
    return result;
  } catch (error: any) {
    console.error("[Playg MCP] Failed to get tools:", error.message);
    return { tools: [] };
  }
}

export async function callPlaygTool(
  name: string,
  args: Record<string, any> = {}
): Promise<any> {
  const client = await getPlaygMcpClient();
  return client.callTool({ name, arguments: args });
}

export async function fetchPlaygJson(urlOrResponseText: string): Promise<any> {
  const url = extractPlaygResponseUrl(urlOrResponseText) ?? urlOrResponseText.trim();
  const token =
    process.env.PLAYG_BEARER_TOKEN || process.env.BEARER_TOKEN || "";

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Playg JSON (${res.status}): ${res.statusText}`);
  }

  const raw = await res.json();
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
