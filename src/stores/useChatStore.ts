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
import { useMapStore } from "./useMapStore";
import { executeClientCommands } from "@/lib/mapExecutor";

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
  isTransparentMode: boolean;
  userLocation: { lat: number; lng: number } | null;

  sendMessage: (text: string) => Promise<void>;
  editAndResendMessage: (messageId: string, newText: string) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
  setChatOpen: (open: boolean) => void;
  toggleMinimize: () => void;
  toggleTransparentMode: () => void;
  setActiveSession: (id: string) => void;
  createNewSession: () => void;
  initUserLocation: () => Promise<void>;
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
  isTransparentMode: false,
  userLocation: null,

  sendMessage: async (text: string) => {
    const currentState = get();
    if (!text.trim() || currentState.isLoading) return;

    // Ensure we have location before sending if possible (wait max 3 seconds)
    if (!currentState.userLocation) {
      await get().initUserLocation();
    }

    // If no active session, create one
    if (!get().activeSessionId) {
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
      
      const response = await fetch("/api/adk-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationHistory,
          sessionId: get().activeSessionId,
          modelId: model.id,
          provider: model.provider,
          apiKey,
          userLocation: get().userLocation,
          mapViewState: useMapStore.getState().mapViewState,
          baseMap: useMapStore.getState().baseMap,
        }),
      });

      if (!response.ok) {
        let apiError = "Failed to get response from AI";
        try {
          const errorData = await response.json();
          if (errorData.error) apiError = errorData.error;
        } catch (e) {}
        toast.error(`Error: ${apiError}`);
        throw new Error(apiError);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalData: any = null;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          
          let event;
          try {
            event = JSON.parse(line);
          } catch (e) {
            console.error("Failed to parse stream event:", line, e);
            continue;
          }
            
          if (event.type === "status") {
            set((state) => {
              const newState = {
                ...state,
                messages: state.messages.map((m) =>
                  m.id === loadingMessage.id
                    ? { ...m, statusMessage: event.message }
                    : m
                ),
              };
              return { ...newState, ...syncSession(newState) };
            });
          } else if (event.type === "stream") {
            set((state) => {
              const newState = {
                ...state,
                messages: state.messages.map((m) =>
                  m.id === loadingMessage.id
                    ? { ...m, content: m.content + event.message }
                    : m
                ),
              };
              return { ...newState, ...syncSession(newState) };
            });
          } else if (event.type === "agent_event") {
            set((state) => {
              const newState = {
                ...state,
                messages: state.messages.map((m) =>
                  m.id === loadingMessage.id
                    ? { ...m, agentEvents: [...(m.agentEvents || []), event.event] }
                    : m
                ),
              };
              return { ...newState, ...syncSession(newState) };
            });
          } else if (event.type === "result") {
            finalData = event.data;
          } else if (event.type === "error") {
            streamError = event.message;
            break;
          }
        }

        if (streamError) break;
      }

      if (streamError) {
        throw new Error(streamError);
      }

      if (!finalData) {
        throw new Error("Did not receive final result from server.");
      }

      toast.success("Received response");

      console.log("💬 [ChatStore] Received finalData from server:", finalData);

      let executionMessages: string[] = [];
      // Execute client tool commands directly (zoom, rotate, etc.) and collect validation results
      if (finalData.clientToolCommands && Array.isArray(finalData.clientToolCommands) && finalData.clientToolCommands.length > 0) {
        console.log("🛠️ [ChatStore] Executing clientToolCommands:", finalData.clientToolCommands);
        const map = useMapStore.getState().mapInstance;
        if (map) {
          const results = await executeClientCommands(map, finalData.clientToolCommands);
          executionMessages = results.map(r => r.success ? `✅ ${r.message}` : `❌ ${r.message}`);
        } else {
          executionMessages = [`❌ Failed to execute map actions: Map instance not ready.`];
        }
      }

      // Use finalData text, but fall back to whatever was streamed during processing
      const streamedContent = get().messages.find(m => m.id === loadingMessage.id)?.content || "";
      let content = finalData.content?.text || streamedContent || "";

      // If we have map commands but no text, generate a brief summary
      if (!content.trim() && executionMessages.length > 0) {
        content = executionMessages.join("\n");
      }

      const assistantMessage: ChatMessage = {
        id: loadingMessage.id,
        role: "assistant",
        content: content || "*(Task completed)*",
        timestamp: Date.now(),
        toolCalls: finalData.toolCalls,
        agentEvents: get().messages.find(m => m.id === loadingMessage.id)?.agentEvents,
        usage: finalData.usage,
        isLoading: false,
        executionMessages: executionMessages.length > 0 ? executionMessages : undefined,
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

      // Format the error nicely as Markdown
      let formattedMarkdown = `### ⚠️ API Error\n\n`;
      const jsonStartIndex = message.indexOf('[{');
      
      if (jsonStartIndex !== -1) {
        const mainMessage = message.substring(0, jsonStartIndex).trim();
        formattedMarkdown += `**Message:** ${mainMessage}\n\n`;
        
        try {
          const jsonStr = message.substring(jsonStartIndex);
          const parsedJson = JSON.parse(jsonStr);
          
          formattedMarkdown += `#### Error Details\n\n`;
          
          parsedJson.forEach((item: any) => {
            if (item['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure') {
              formattedMarkdown += `**Quota Exceeded**\n`;
              item.violations?.forEach((v: any) => {
                formattedMarkdown += `- **Metric**: \`${v.quotaMetric}\`\n`;
                formattedMarkdown += `- **Limit**: \`${v.quotaValue}\`\n`;
                if (v.quotaDimensions?.model) {
                  formattedMarkdown += `- **Model**: \`${v.quotaDimensions.model}\`\n`;
                }
              });
              formattedMarkdown += `\n`;
            } else if (item['@type'] === 'type.googleapis.com/google.rpc.RetryInfo') {
               formattedMarkdown += `**Action:** Please retry in \`${item.retryDelay}\`.\n\n`;
            } else if (item['@type'] === 'type.googleapis.com/google.rpc.Help') {
               item.links?.forEach((l: any) => {
                 formattedMarkdown += `[${l.description}](${l.url})\n\n`;
               });
            } else {
               // Fallback for unknown details
               formattedMarkdown += `\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\`\n\n`;
            }
          });
        } catch(e) {
          formattedMarkdown += `\`\`\`text\n${message.substring(jsonStartIndex)}\n\`\`\``;
        }
      } else {
        formattedMarkdown += message;
      }

      // Replace loading with error message
      const errorMessage: ChatMessage = {
        id: loadingMessage.id,
        role: "assistant",
        content: formattedMarkdown,
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

  editAndResendMessage: async (messageId: string, newText: string) => {
    const state = get();
    if (state.isLoading || !newText.trim()) return;

    const messageIndex = state.messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    // Truncate messages to remove this message and everything after it
    set((s) => {
      const newState = {
        ...s,
        messages: s.messages.slice(0, messageIndex),
        error: null,
      };
      return { ...newState, ...syncSession(newState) };
    });

    // Call normal sendMessage with the new text
    await get().sendMessage(newText);
  },

  clearMessages: () => set((state) => {
    const newSessionId = generateId();
    const newState = { ...state, activeSessionId: newSessionId, messages: [], error: null };
    return { ...newState, ...syncSession(newState) };
  }),
  clearError: () => set({ error: null }),
  setChatOpen: (open: boolean) => set({ isChatOpen: open, isChatMinimized: false }),
  toggleMinimize: () => set((state) => ({ isChatMinimized: !state.isChatMinimized })),
  toggleTransparentMode: () => set((state) => ({ isTransparentMode: !state.isTransparentMode })),
  
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

  initUserLocation: async () => {
    if (get().userLocation) return;
    
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { 
            enableHighAccuracy: true, 
            timeout: 3000, 
            maximumAge: 60000 
          });
        });
        
        set({
          userLocation: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          }
        });
      } catch (error) {
        console.warn("Geolocation error:", error);
      }
    }
  },
};
});
