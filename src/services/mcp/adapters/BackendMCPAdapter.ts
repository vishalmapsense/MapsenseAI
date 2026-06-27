/**
 * Backend MCP Client Adapter — Future Placeholder
 * ─────────────────────────────────────────────────────────────
 * Jab apna backend MCP server ready ho:
 * 1. ACTIVE_MCP_PROVIDER = "backend" karo in mcp.config.ts
 * 2. Is class mein real implementation dalo
 * ─────────────────────────────────────────────────────────────
 */

import {
  MCPAdapter,
  MCPChatResponse,
  MCPProxyRequest,
  MCPProxyResponse,
  MCPTool,
  MessageRole,
} from "@/types/mcp.types";

const MCP_PROXY_URL = "/api/mcp";

async function proxyCall<T>(request: MCPProxyRequest): Promise<T> {
  const res = await fetch(MCP_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const json: MCPProxyResponse = await res.json();
  if (!json.success) throw new Error(json.error ?? "Backend MCP call failed");
  return json.data as T;
}

export class BackendMCPAdapter implements MCPAdapter {
  async listTools(): Promise<MCPTool[]> {
    return proxyCall<MCPTool[]>({ action: "listTools" });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return proxyCall<unknown>({ action: "callTool", toolName: name, toolArgs: args });
  }

  async chat(
    messages: Array<{ role: MessageRole; content: string }>,
    systemPrompt?: string
  ): Promise<MCPChatResponse> {
    return proxyCall<MCPChatResponse>({ action: "chat", messages, systemPrompt });
  }
}
