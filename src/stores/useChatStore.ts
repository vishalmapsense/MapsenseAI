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

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;

  isChatOpen: boolean;
  isChatMinimized: boolean;

  sendMessage: (text: string) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
  setChatOpen: (open: boolean) => void;
  toggleMinimize: () => void;
  setActiveSession: (id: string) => void;
  createNewSession: () => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useChatStore = create<ChatState>((set, get) => {
  const syncSession = (state: ChatState) => {
    if (!state.activeSessionId) return state;
    const sessionIndex = state.sessions.findIndex((s) => s.id === state.activeSessionId);
    if (sessionIndex === -1) return state;
    
    const newSessions = [...state.sessions];
    newSessions[sessionIndex] = {
      ...newSessions[sessionIndex],
      messages: state.messages,
      updatedAt: Date.now(),
      // update title if it's "New Chat" and we just got the first user message
      title: (newSessions[sessionIndex].title === "New Chat" && state.messages.length > 0)
        ? state.messages[0].content.slice(0, 30) + (state.messages[0].content.length > 30 ? "..." : "")
        : newSessions[sessionIndex].title,
    };
    return { sessions: newSessions };
  };

  return {
  sessions: [],
  activeSessionId: null,
  messages: [],
  isLoading: false,
  error: null,
  isChatOpen: false,
  isChatMinimized: false,

  sendMessage: async (text: string) => {
    const currentState = get();
    if (!text.trim() || currentState.isLoading) return;

    // If no active session, create one
    if (!currentState.activeSessionId) {
      get().createNewSession();
    }
    if (!text.trim() || get().isLoading) return;

    // Auto-open chat and un-minimize when sending
    set((state) => syncSession({ ...state, isChatOpen: true, isChatMinimized: false }));

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

    set((state) => {
      const newState = {
        ...state,
        messages: [...state.messages, userMessage, loadingMessage],
        isLoading: true,
        error: null,
      };
      return { ...newState, ...syncSession(newState) };
    });

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

      set((state) => {
        const newState = {
          ...state,
          messages: state.messages.map((m) =>
            m.id === loadingMessage.id ? assistantMessage : m
          ),
          isLoading: false,
        };
        return { ...newState, ...syncSession(newState) };
      });
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

      set((state) => {
        const newState = {
          ...state,
          messages: state.messages.map((m) =>
            m.id === loadingMessage.id ? errorMessage : m
          ),
          isLoading: false,
          error: message,
        };
        return { ...newState, ...syncSession(newState) };
      });
    }
  },

  clearMessages: () => set((state) => {
    const newState = { ...state, messages: [], error: null };
    return { ...newState, ...syncSession(newState) };
  }),
  clearError: () => set({ error: null }),
  setChatOpen: (open: boolean) => set({ isChatOpen: open, isChatMinimized: false }),
  toggleMinimize: () => set((state) => ({ isChatMinimized: !state.isChatMinimized })),
  
  setActiveSession: (id: string) => set((state) => {
    const session = state.sessions.find(s => s.id === id);
    if (!session) return state;
    return { activeSessionId: id, messages: session.messages, error: null, isChatOpen: true, isChatMinimized: false };
  }),
  
  createNewSession: () => set((state) => {
    const newSession: ChatSession = {
      id: generateId(),
      title: "New Chat",
      messages: [],
      updatedAt: Date.now()
    };
    return {
      sessions: [newSession, ...state.sessions],
      activeSessionId: newSession.id,
      messages: [],
      error: null,
      isChatOpen: true,
      isChatMinimized: false
    };
  }),
};
});
