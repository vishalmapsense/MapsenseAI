/**
 * Chat Store — Zustand
 * ─────────────────────────────────────────────────────────────
 * Global chat state: messages, loading, errors.
 * MCPClientService se baat karta hai — MCP provider agnostic.
 * ─────────────────────────────────────────────────────────────
 */

import { create } from "zustand";
import { useModelSettingsStore } from "./useModelSettingsStore";
import { ChatMessage } from "@/types/mcp.types";
import { toast } from "sonner";

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
      const { selectedModelId, getSelectedModel, getApiKeyForModel } = useModelSettingsStore.getState();
      const model = getSelectedModel();
      if (!model) throw new Error("No model selected");
      
      const apiKey = getApiKeyForModel(model);
      if (model.requiresApiKey && !apiKey) {
        const errorMsg = `API key missing for ${model.name}. Please add it in Settings.`;
        toast.warning(errorMsg);
        throw new Error(errorMsg);
      }

      const conversationHistory = get()
        .messages.filter((m) => !m.isLoading)
        .map((m) => ({ role: m.role, content: m.content }));
      
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...conversationHistory, { role: "user", content: text.trim() }],
          modelId: model.id,
          provider: model.provider,
          apiKey,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const apiError = errorData.error || "Failed to get response from AI";
        toast.error(`Error: ${apiError}`);
        throw new Error(apiError);
      }

      const data = await response.json();
      toast.success("Received response");

      // Replace loading message with actual response
      const assistantMessage: ChatMessage = {
        id: loadingMessage.id,
        role: "assistant",
        content: data.content,
        timestamp: Date.now(),
        toolCalls: data.toolCalls,
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
      
      // If it wasn't already caught by the API key check or response.ok check, show generic error toast
      if (!message.includes("API key missing") && !message.startsWith("Error:")) {
         toast.error(message);
      }

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
