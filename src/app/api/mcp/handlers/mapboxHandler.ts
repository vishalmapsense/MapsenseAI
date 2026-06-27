/**
 * Mapbox MCP Handler — stdio transport
 * ─────────────────────────────────────────────────────────────
 * Ye handler local Mapbox MCP server process ko spawn karta hai,
 * JSON-RPC messages stdin mein likhta hai,
 * aur stdout se response parse karta hai.
 *
 * MCP Protocol: JSON-RPC 2.0 over stdio (newline-delimited)
 * ─────────────────────────────────────────────────────────────
 */

import { spawn } from "child_process";
import { MAPBOX_MCP_CONFIG } from "@/config/mcp.config";
import { MCPProxyRequest, MCPProxyResponse, MCPTool } from "@/types/mcp.types";

// ─── JSON-RPC Helper ──────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── Core: Spawn + Communicate ────────────────────────────────

/**
 * Ek fresh MCP stdio process spawn karo,
 * ek JSON-RPC call karo, response lo, process band karo.
 *
 * Note: Har call pe naya process banata hai — simple aur stateless.
 * Production mein ise singleton/pool se replace kar sakte hain.
 */
export async function callMCPProcess(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 15000
): Promise<unknown> {
  const scriptPath = MAPBOX_MCP_CONFIG.serverScriptPath;
  const accessToken = MAPBOX_MCP_CONFIG.accessToken;

  if (!scriptPath) {
    throw new Error(
      "MAPBOX_MCP_SCRIPT_PATH environment variable is not set. " +
        "Please add it to your .env.local file."
    );
  }

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      MAPBOX_ACCESS_TOKEN: accessToken,
    };

    // Spawn the MCP server process
    const child = spawn("node", [scriptPath], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let initDone = false;
    let requestId = 1;

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Listen to stdout for JSON-RPC responses
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();

      // Parse newline-delimited JSON-RPC messages
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? ""; // Keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const msg: JsonRpcResponse = JSON.parse(trimmed);

          if (!initDone && msg.id === 0) {
            // Initialize response received — now send the actual request
            initDone = true;
            const rpcRequest: JsonRpcRequest = {
              jsonrpc: "2.0",
              id: requestId,
              method,
              ...(params ? { params } : {}),
            };
            child.stdin.write(JSON.stringify(rpcRequest) + "\n");
          } else if (msg.id === requestId) {
            // Our actual request's response
            clearTimeout(timeout);
            child.kill();

            if (msg.error) {
              reject(new Error(`MCP Error [${msg.error.code}]: ${msg.error.message}`));
            } else {
              resolve(msg.result);
            }
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      // MCP servers often log to stderr — not always an error
      const msg = chunk.toString();
      if (msg.toLowerCase().includes("error")) {
        console.error("[Mapbox MCP stderr]", msg);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn MCP process: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`MCP process exited with code ${code}`));
      }
    });

    // Step 1: Send MCP initialize handshake
    const initRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mapsense-ai", version: "1.0.0" },
      },
    };
    child.stdin.write(JSON.stringify(initRequest) + "\n");
  });
}

// ─── Public Handler ───────────────────────────────────────────

export async function handleMapboxMCPRequest(
  body: MCPProxyRequest
): Promise<MCPProxyResponse> {
  try {
    switch (body.action) {
      case "listTools": {
        const result = await callMCPProcess("tools/list");
        const tools = (result as { tools: MCPTool[] }).tools;
        return { success: true, data: tools };
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
        // For chat: first list tools, then let AI decide which to call
        // This is a simplified version — you can wire in an LLM here later
        const toolsResult = await callMCPProcess("tools/list");
        const tools = (toolsResult as { tools: MCPTool[] }).tools;

        return {
          success: true,
          data: {
            content: "Tools available from Mapbox MCP server:",
            availableTools: tools,
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
