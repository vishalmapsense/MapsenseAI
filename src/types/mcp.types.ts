/**
 * MCP Types & Interfaces
 * ─────────────────────────────────────────────────────────────
 * Ye types dono adapters (Mapbox + Backend) implement karte hain.
 * Isse UI layer ko koi fark nahi padta ki kaunsa MCP use ho raha hai.
 * ─────────────────────────────────────────────────────────────
 */

// ─── Chat Message Types ────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system";

export interface TokenUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCalls?: MCPToolCall[];
  isLoading?: boolean;
  usage?: TokenUsage;
  executionMessages?: string[];
}

// ─── MCP Tool Types ────────────────────────────────────────────

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  /** Agar tool result large tha aur resource store mein gaya, to yahan URI hoga */
  resourceUri?: string;
}

// ─── MCP Resource Types ───────────────────────────────────────

/** MCP resource mechanism se fetched GeoJSON resource ka descriptor */
export interface GeoJSONResource {
  uri: string;       // e.g. "geojson://resource/uuid"
  sizeBytes: number;
  storedAt: number;
  expiresAt: number;
}

// ─── MCP Adapter Interface ────────────────────────────────────
// Har provider (mapbox, backend) ko ye interface implement karna hoga

export interface MCPAdapter {
  /**
   * MCP server se available tools list karo.
   */
  listTools(): Promise<MCPTool[]>;

  /**
   * Ek specific tool call karo aur result wapas lao.
   */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;

  /**
   * User message bhejo — AI response aur tool calls return hote hain.
   * (High-level: internally listTools + callTool use karta hai)
   */
  chat(
    messages: Array<{ role: MessageRole; content: string }>,
    systemPrompt?: string
  ): Promise<MCPChatResponse>;
}

// ─── MCP Response Types ────────────────────────────────────────

export interface MCPChatResponse {
  content: string;
  toolCalls?: MCPToolCall[];
}

// ─── API Proxy Request/Response (for Next.js route) ───────────

export interface MCPProxyRequest {
  action: "listTools" | "callTool" | "chat";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  messages?: Array<{ role: MessageRole; content: string }>;
  systemPrompt?: string;
}

export interface MCPProxyResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}
