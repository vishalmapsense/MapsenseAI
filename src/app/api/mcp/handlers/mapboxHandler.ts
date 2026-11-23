/**
 * Mapbox MCP Handler — using official SDK with Stdio transport
 * ─────────────────────────────────────────────────────────────
 * Ye handler local/server Mapbox MCP process se connect karta hai
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
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ─── Global Singleton for MCP Client ─────────────────────────

if ((globalThis as any)._mcpClient) {
  try {
    (globalThis as any)._mcpClient.close();
  } catch(e) {}
  (globalThis as any)._mcpClient = null;
}
let mcpClient: Client | null = null;
async function getMcpClient(): Promise<Client> {
  if (mcpClient) {
    // Health check: try a lightweight ping to see if the connection is still alive
    try {
      await mcpClient.listTools();
      return mcpClient;
    } catch (err) {
      console.warn("[MCP] Stale connection detected, reconnecting...");
      mcpClient = null;
      (globalThis as any)._mcpClient = null;
      (globalThis as any)._mcpTools = null;
      cachedTools = null;
    }
  }

  const hostedUrl = MAPBOX_MCP_CONFIG.hostedUrl;
  const scriptPath = MAPBOX_MCP_CONFIG.serverScriptPath;
  const accessToken = MAPBOX_MCP_CONFIG.accessToken;

  // 1. Try Hosted Endpoint first (https://mcp.mapbox.com/mcp)
  if (hostedUrl) {
    try {
      console.log(`[MCP] Attempting connection to Mapbox hosted endpoint: ${hostedUrl}`);
      const httpTransport = new StreamableHTTPClientTransport(
        new URL(hostedUrl),
        {
          requestInit: {
            headers: {
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
          },
        }
      );

      const client = new Client(
        {
          name: "mapsense-ai",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      await client.connect(httpTransport);
      const tools = await client.listTools();
      if (tools && tools.tools && tools.tools.length > 0) {
        console.log(`✅ [MCP] Connected to Mapbox hosted endpoint! (${tools.tools.length} tools)`);
        mcpClient = client;
        (globalThis as any)._mcpClient = mcpClient;
        return mcpClient;
      }
    } catch (httpErr: any) {
      console.warn(
        `⚠️ [MCP] Hosted endpoint connection failed (${httpErr?.message || httpErr}). Falling back to stdio...`
      );
    }
  }

  // 2. Fallback to stdio process (node scriptPath or npx @mapbox/mcp-server)
  const command = scriptPath ? "node" : "npx";
  const args = scriptPath ? [scriptPath] : ["-y", "@mapbox/mcp-server"];

  console.log(`[MCP] Starting Mapbox MCP via ${command} ${args.join(" ")}`);

  const transport = new StdioClientTransport({
    command,
    args,
    env: {
      ...process.env,
      CLIENT_NEEDS_RESOURCE_FALLBACK: "true",
      MAPBOX_ACCESS_TOKEN: accessToken,
      MAPBOX_SECRET_TOKEN: accessToken,
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

/**
 * Force reconnect the MCP client (useful after errors).
 */
async function reconnectMcpClient(): Promise<Client> {
  console.log("[MCP] Force reconnecting...");
  try {
    if (mcpClient) {
      await mcpClient.close().catch(() => {});
    }
  } catch {}
  mcpClient = null;
  (globalThis as any)._mcpClient = null;
  (globalThis as any)._mcpTools = null;
  cachedTools = null;
  return getMcpClient();
}

// ─── Core Execution wrapper ───────────────────────────────────

let cachedTools: any = (globalThis as any)._mcpTools || null;

const MAX_RETRIES = 2;

export async function callMCPProcess(
  method: string,
  params?: any
): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = attempt === 0 ? await getMcpClient() : await reconnectMcpClient();

      if (method === "tools/list") {
        if (cachedTools && attempt === 0) return cachedTools;
        const result = await client.listTools();
        cachedTools = result;
        (globalThis as any)._mcpTools = cachedTools;
        return result;
      }

      if (method === "tools/call") {
        const result = await client.callTool({
          name: params.name,
          arguments: params.arguments,
        });

        // Check if the MCP server itself reported an error
        if (result && (result as any).isError) {
          const errorContent = (result as any).content;
          let errorMsg = "MCP tool returned an error";
          if (Array.isArray(errorContent)) {
            for (const block of errorContent) {
              if (block.type === "text" && block.text) {
                try {
                  const parsed = JSON.parse(block.text);
                  errorMsg = parsed.message || errorMsg;
                } catch {
                  errorMsg = block.text;
                }
              }
            }
          }

          // If it's a "fetch failed" type error, retry with reconnect
          if (errorMsg.includes("fetch failed") && attempt < MAX_RETRIES) {
            console.warn(`[MCP] Tool returned fetch error, retry ${attempt + 1}/${MAX_RETRIES}...`);
            lastError = new Error(errorMsg);
            continue;
          }

          // Non-retryable MCP error — return it as-is for the LLM to handle
          return result;
        }

        return result;
      }

      if (method === "resources/read") {
        return await client.readResource({
          uri: params.uri,
        });
      }

      throw new Error(`Unsupported MCP method: ${method}`);
    } catch (err: any) {
      lastError = err;
      console.error(`[MCP] Attempt ${attempt + 1} failed:`, err.message);

      if (attempt < MAX_RETRIES) {
        // Wait a bit before retrying
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError || new Error("MCP call failed after retries");
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
