/**
 * Shared ADK Chat Stream Protocol
 * ─────────────────────────────────────────────────────────────
 * Defines the channel naming, event key, and payload shape shared
 * between `/api/adk-chat` (server) and `adkStreamClient` (browser).
 */

export const ADK_STREAM_EVENT = "adk_event";

export interface AdkStreamEvent {
  seq?: number;
  type: "status" | "stream" | "agent_event" | "result" | "error";
  message?: string;
  event?: any;
  data?: any;
}

export function getAdkStreamChannelName(requestId: string): string {
  return `chat-stream:${requestId}`;
}
