/**
 * Mapbox MCP Client Adapter (Browser-side)
 * ─────────────────────────────────────────────────────────────
 * Ye adapter browser mein chal ta hai aur /api/mcp proxy ko call karta hai.
 * Direct stdio communication browser se possible nahi — isliye proxy.
 * ─────────────────────────────────────────────────────────────
 */

import {
  MCPAdapter,
  MCPChatResponse,
  MCPProxyRequest,
  MCPProxyResponse,
  MCPTool,
  MCPToolCall,
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

  if (!json.success) {
    throw new Error(json.error ?? "MCP proxy call failed");
  }

  return json.data as T;
}

export class MapboxMCPAdapter implements MCPAdapter {
  async listTools(): Promise<MCPTool[]> {
    return proxyCall<MCPTool[]>({ action: "listTools" });
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return proxyCall<unknown>({
      action: "callTool",
      toolName: name,
      toolArgs: args,
    });
  }

  async chat(
    messages: Array<{ role: MessageRole; content: string }>,
    systemPrompt?: string
  ): Promise<MCPChatResponse> {
    const response = await proxyCall<{
      content: string;
      availableTools?: MCPTool[];
      userMessage?: string;
    }>({
      action: "chat",
      messages,
      systemPrompt,
    });

    const toolCalls: MCPToolCall[] = [];

    // If tools are available, parse user intent and call relevant tools
    if (response.availableTools && response.userMessage) {
      const matched = await this.matchAndCallTools(
        response.userMessage,
        response.availableTools
      );
      toolCalls.push(...matched);
    }

    return {
      content: response.content,
      toolCalls,
    };
  }

  /**
   * Simple keyword-based tool matching.
   * Baad mein ise LLM-based intent detection se replace kar sakte hain.
   */
  private async matchAndCallTools(
    userMessage: string,
    tools: MCPTool[]
  ): Promise<MCPToolCall[]> {
    const lower = userMessage.toLowerCase();
    const results: MCPToolCall[] = [];

    for (const tool of tools) {
      const toolWords = tool.name.toLowerCase().replace(/_/g, " ").split(" ");
      const isMatch = toolWords.some((word) => lower.includes(word));

      if (isMatch) {
        try {
          const result = await this.callTool(tool.name, {});
          results.push({ toolName: tool.name, arguments: {}, result });
        } catch (err) {
          console.warn(`[MapboxMCPAdapter] Tool call failed: ${tool.name}`, err);
        }
      }
    }

    return results;
  }
}
