import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

  const transport = new StdioClientTransport({
    command: "node",
    args: [
      process.env.PLAYG_MCP_SCRIPT_PATH ||
        "",
    ],
    env: {
      ...process.env,
      PLAYG_API_BASE: process.env.PLAYG_API_BASE || "http://localhost:8000",
      USER_AGENT: process.env.PLAYG_USER_AGENT || "playg-mcp-server/1.0",
      REDIS_URL:
        process.env.PLAYG_REDIS_URL ||
        process.env.REDIS_URL ||
        "redis://localhost:6379",
      BEARER_TOKEN:
        process.env.PLAYG_BEARER_TOKEN || process.env.BEARER_TOKEN || "",
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
  let url = urlOrResponseText;
  if (url.includes("Response_URL: ")) {
    url = url.split("Response_URL: ")[1].trim();
  }
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
