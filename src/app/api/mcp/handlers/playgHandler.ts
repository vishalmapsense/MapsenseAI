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
    args: ["/Users/vishalkushwaha/Mapsense/MapsenseAI/playg-mcp-server/build/index.js"],
    env: {
      ...process.env,
      PLAYG_API_BASE: "https://backend.mapsense.in/api",
      USER_AGENT: "playg-mcp-server/1.0",
      REDIS_URL: "redis://localhost:6379",
      BEARER_TOKEN: "",
      INSTANCE_PATH: "",
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
