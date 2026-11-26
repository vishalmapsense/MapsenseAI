/**
 * ADK Dual-Transport Stream Client
 * ─────────────────────────────────────────────────────────────
 * Combines two transports for `/api/adk-chat`:
 *  1. Supabase Realtime Broadcast (`chat-stream:<requestId>`) — delivers
 *     `status`, `agent_event`, and `stream` events in real time even on
 *     hosting layers that buffer HTTP streaming responses (e.g. AWS Amplify SSR).
 *  2. HTTP NDJSON ReadableStream (`fetch("/api/adk-chat")`) — works directly
 *     in local dev/streaming hosts and always delivers the authoritative final `result`.
 *
 * Events carry a monotonic `seq` number and are deduplicated via `seenSeqs`
 * so each event updates UI state exactly once.
 */

import { createClient } from "@/utils/supabase/client";
import {
  ADK_STREAM_EVENT,
  getAdkStreamChannelName,
  type AdkStreamEvent,
} from "./adkStreamProtocol";

export interface StreamAdkChatOptions {
  payload: Record<string, any>;
  defaultHttpError: string;
  onHttpErrorToast?: (message: string) => void;
  onStatus: (message: string) => void;
  onStream: (chunk: string) => void;
  onAgentEvent: (event: any) => void;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return Boolean(url && !url.includes("placeholder-url"));
}

async function subscribeWithTimeout(
  supabase: ReturnType<typeof createClient>,
  channelName: string,
  onBroadcast: (payload: AdkStreamEvent) => void,
  timeoutMs = 1200,
) {
  const channel = supabase.channel(channelName);
  channel.on("broadcast", { event: ADK_STREAM_EVENT }, (msg) => {
    if (msg?.payload) {
      onBroadcast(msg.payload as AdkStreamEvent);
    }
  });

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        done();
      }
    });
  });

  return channel;
}

/**
 * Streams a chat turn from `/api/adk-chat`, merging live Supabase Realtime
 * broadcasts with the HTTP NDJSON response stream, and resolves with `result.data`.
 */
export async function streamAdkChat(options: StreamAdkChatOptions): Promise<any> {
  const {
    payload,
    defaultHttpError,
    onHttpErrorToast,
    onStatus,
    onStream,
    onAgentEvent,
  } = options;

  const requestId = createRequestId();
  const seenSeqs = new Set<number>();
  let finalData: any = null;
  let streamError: string | null = null;
  let closed = false;

  const handleEvent = (event: AdkStreamEvent) => {
    if (closed || !event || typeof event !== "object") return;
    if (typeof event.seq === "number") {
      if (seenSeqs.has(event.seq)) return;
      seenSeqs.add(event.seq);
    }

    if (event.type === "status" && typeof event.message === "string") {
      onStatus(event.message);
    } else if (event.type === "stream" && typeof event.message === "string") {
      onStream(event.message);
    } else if (event.type === "agent_event" && event.event) {
      onAgentEvent(event.event);
    } else if (event.type === "result") {
      finalData = event.data;
    } else if (event.type === "error") {
      streamError = event.message || "Internal Server Error";
    }
  };

  let supabase: ReturnType<typeof createClient> | null = null;
  let realtimeChannel: any = null;

  if (isSupabaseConfigured()) {
    try {
      supabase = createClient();
      realtimeChannel = await subscribeWithTimeout(
        supabase,
        getAdkStreamChannelName(requestId),
        handleEvent,
      );
    } catch (err) {
      console.warn("⚠️ [AdkStreamClient] Supabase Realtime subscribe failed, using HTTP stream:", err);
    }
  }

  try {
    const response = await fetch("/api/adk-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, requestId }),
    });

    if (!response.ok) {
      let apiError = defaultHttpError;
      try {
        const errorData = await response.json();
        if (errorData.error) apiError = errorData.error;
      } catch {}
      onHttpErrorToast?.(apiError);
      throw new Error(apiError);
    }

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const processLines = (lines: string[]) => {
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as AdkStreamEvent;
          handleEvent(parsed);
        } catch (e) {
          console.error("Failed to parse stream event:", line, e);
        }
        if (streamError) break;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) {
          processLines(buffer.split("\n"));
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      processLines(lines);

      if (streamError) break;
    }

    if (streamError) {
      throw new Error(streamError);
    }

    if (!finalData) {
      throw new Error("Did not receive final result from server.");
    }

    return finalData;
  } finally {
    closed = true;
    if (supabase && realtimeChannel) {
      supabase.removeChannel(realtimeChannel).catch(() => {});
    }
  }
}
