/**
 * Chat Store — Zustand
 * ─────────────────────────────────────────────────────────────
 * Global chat state: messages, loading, errors.
 * MCPClientService se baat karta hai — MCP provider agnostic.
 * ─────────────────────────────────────────────────────────────
 */

import { create } from "zustand";
import { getMCPAdapter } from "@/services/mcp/MCPClientService";
import { ChatMessage } from "@/types/mcp.types";

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;

  sendMessage: (text: string) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  error: null,

  sendMessage: async (text: string) => {
    if (!text.trim() || get().isLoading) return;

    // Add user message immediately
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };

    // Add loading assistant placeholder
    const loadingMessage: ChatMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isLoading: true,
    };

    set((state) => ({
      messages: [...state.messages, userMessage, loadingMessage],
      isLoading: true,
      error: null,
    }));

    try {
      const adapter = getMCPAdapter();
      const conversationHistory = get()
        .messages.filter((m) => !m.isLoading)
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await adapter.chat(
        [...conversationHistory, { role: "user", content: text.trim() }],
        "You are MapsenseAI, a helpful geospatial assistant. Help users analyze maps and geographic data."
      );

      // Replace loading message with actual response
      const assistantMessage: ChatMessage = {
        id: loadingMessage.id,
        role: "assistant",
        content: response.content,
        timestamp: Date.now(),
        toolCalls: response.toolCalls,
        isLoading: false,
      };

      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === loadingMessage.id ? assistantMessage : m
        ),
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to get response";

      // Replace loading with error message
      const errorMessage: ChatMessage = {
        id: loadingMessage.id,
        role: "assistant",
        content: `⚠️ Error: ${message}`,
        timestamp: Date.now(),
        isLoading: false,
      };

      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === loadingMessage.id ? errorMessage : m
        ),
        isLoading: false,
        error: message,
      }));
    }
  },

  clearMessages: () => set({ messages: [], error: null }),
  clearError: () => set({ error: null }),
}));
