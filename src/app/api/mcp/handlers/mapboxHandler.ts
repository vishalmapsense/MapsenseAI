/**
 * Mapbox MCP Handler — using official SDK
 * ─────────────────────────────────────────────────────────────
 * Ye handler local Mapbox MCP server se connect karta hai
 * using the official @modelcontextprotocol/sdk.
 *
 * It uses a global singleton to keep the MCP process alive
 * across requests, which is CRITICAL for the Mapbox MCP server's
 * `temporaryResourceManager` to retain resources between
 * a `tools/call` and a subsequent `resources/read`.
 * ─────────────────────────────────────────────────────────────
 */

import { MAPBOX_MCP_CONFIG } from "@/config/mcp.config";
import { MCPProxyRequest, MCPProxyResponse, MCPTool } from "@/types/mcp.types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ─── Global Singleton for MCP Client ─────────────────────────

let mcpClient: Client | null = (globalThis as any)._mcpClient || null;

async function getMcpClient(): Promise<Client> {
  if (mcpClient) {
    return mcpClient;
  }

  const scriptPath = MAPBOX_MCP_CONFIG.serverScriptPath;
  const accessToken = MAPBOX_MCP_CONFIG.accessToken;

  if (!scriptPath) {
    throw new Error(
      "MAPBOX_MCP_SCRIPT_PATH environment variable is not set. " +
        "Please add it to your .env.local file."
    );
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [scriptPath],
    env: {
      ...process.env,
      MAPBOX_ACCESS_TOKEN: accessToken,
    },
  });

  const client = new Client(
    {
      name: "mapsense-ai",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  mcpClient = client;
  (globalThis as any)._mcpClient = mcpClient;

  return mcpClient;
}

// ─── Core Execution wrapper ───────────────────────────────────

let cachedTools: any = (globalThis as any)._mcpTools || null;

export async function callMCPProcess(
  method: string,
  params?: any
): Promise<unknown> {
  const client = await getMcpClient();

  if (method === "tools/list") {
    if (cachedTools) return cachedTools;
    const result = await client.listTools();
    cachedTools = result;
    (globalThis as any)._mcpTools = cachedTools;
    return result;
  }

  if (method === "tools/call") {
    return await client.callTool({
      name: params.name,
      arguments: params.arguments,
    });
  }
  
  if (method === "resources/read") {
    return await client.readResource({
      uri: params.uri,
    });
  }

  throw new Error(`Unsupported MCP method: ${method}`);
}

// ─── Public Handler for Next.js API Route ─────────────────────

export async function handleMapboxMCPRequest(
  body: MCPProxyRequest
): Promise<MCPProxyResponse> {
  try {
    switch (body.action) {
      case "listTools": {
        const result: any = await callMCPProcess("tools/list");
        return { success: true, data: result.tools };
      }

      case "callTool": {
        if (!body.toolName) {
          return { success: false, error: "toolName is required for callTool action" };
        }
        const result = await callMCPProcess("tools/call", {
          name: body.toolName,
          arguments: body.toolArgs ?? {},
        });
        return { success: true, data: result };
      }

      case "chat": {
        const toolsResult: any = await callMCPProcess("tools/list");
        return {
          success: true,
          data: {
            content: "Tools available from Mapbox MCP server:",
            availableTools: toolsResult.tools,
            userMessage: body.messages?.[body.messages.length - 1]?.content ?? "",
          },
        };
      }

      default:
        return { success: false, error: `Unknown action: ${body.action}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Mapbox MCP Handler]", message);
    return { success: false, error: message };
  }
}
