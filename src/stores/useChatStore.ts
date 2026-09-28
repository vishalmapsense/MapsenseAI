/**
 * Chat Store — Zustand
 * ─────────────────────────────────────────────────────────────
 * Global chat state: messages, loading, errors.
 * MCPClientService se baat karta hai — MCP provider agnostic.
 * ─────────────────────────────────────────────────────────────
 */

import { create } from "zustand";
import { useModelSettingsStore } from "./useModelSettingsStore";
import { useAuthStore } from "./useAuthStore";
import { ChatMessage, QueryResultData } from "@/types/mcp.types";
import { toast } from "sonner";
import { useMapStore } from "./useMapStore";
import { executeClientCommands } from "@/lib/mapExecutor";
import { fetchSessionLayers, deleteAllLayers, setSessionLayersCache } from "@/services/layerSyncService";
import { queryResultService } from "@/services/queryResultService";

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const RECENT_SHARED_KEY = "mapsense_recent_shared_sessions";

export function getRecentSharedSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_SHARED_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

function saveRecentSharedSession(session: ChatSession) {
  if (typeof window === "undefined") return;
  const existing = getRecentSharedSessions();
  const filtered = existing.filter((s) => s.id !== session.id);
  // Keep basic info (no messages) to save space
  filtered.unshift({ id: session.id, title: session.title, messages: [], updatedAt: session.updatedAt });
  localStorage.setItem(RECENT_SHARED_KEY, JSON.stringify(filtered.slice(0, 10))); // Keep last 10
}

export function clearRecentSharedSessions() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(RECENT_SHARED_KEY);
  }
}

export function removeRecentSharedSession(sessionId: string) {
  if (typeof window !== "undefined") {
    const existing = getRecentSharedSessions();
    const filtered = existing.filter((s) => s.id !== sessionId);
    localStorage.setItem(RECENT_SHARED_KEY, JSON.stringify(filtered));
  }
}

export interface SharedSessionRecord {
  share_token: string;
  user_id: string;
  session_id: string;
  title: string;
  is_public: boolean;
  created_at: string;
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
  mySharedSessions: SharedSessionRecord[];
  selectedLayersForChat: any[];
  selectedFilesForChat: string[];

  sendMessage: (text: string) => Promise<void>;
  editAndResendMessage: (messageId: string, newText: string) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
  setChatOpen: (open: boolean) => void;
  toggleMinimize: () => void;
  toggleTransparentMode: () => void;
  setActiveSession: (id: string) => void;
  createNewSession: () => void;
  fetchSessions: () => Promise<void>;
  loadSessionHistory: (sessionId: string) => Promise<void>;
  loadSharedSession: (shareId: string) => Promise<void>;
  clearSharedSessionCache: (sessionId?: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteAllSessions: () => void;
  renameSession: (sessionId: string, newTitle: string) => void;
  initUserLocation: () => Promise<void>;
  fetchMySharedSessions: () => Promise<void>;
  toggleShareStatus: (shareToken: string, isPublic: boolean) => Promise<void>;
  shareSession: (sessionId: string, title?: string) => Promise<string | null>;
  deleteSharedSession: (shareToken: string) => Promise<void>;
  addSelectedLayer: (layer: any) => void;
  clearSelectedLayers: () => void;
  addSelectedFile: (path: string) => void;
  removeSelectedFile: (path: string) => void;
  clearSelectedFiles: () => void;

  permissionRequest: { title: string; message: string; options: string[]; for_tool?: string } | null;
  clearPermissionRequest: () => void;

  // DuckDB Query Results Panel (temporary, client-only — NOT persisted to Supabase)
  queryResultsPanel: QueryResultData[];
  isQueryPanelOpen: boolean;
  addQueryResults: (results: QueryResultData[]) => void;
  clearQueryResults: () => void;
  removeQueryResult: (queryId: string) => Promise<void>;
  fetchQueryResults: (sessionId: string) => Promise<void>;
  toggleQueryPanel: () => void;

  // Map SQL floating chat window
  mapSqlChat: {
    isOpen: boolean;
    messages: ChatMessage[];
    isLoading: boolean;
    clickCoords: { x: number; y: number; lng: number; lat: number } | null;
  };
  openMapSqlChat: (coords: { x: number; y: number; lng: number; lat: number }) => void;
  closeMapSqlChat: () => void;
  sendMapSqlMessage: (text: string, additionalContext?: string) => Promise<void>;
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
        ? "Generating title..."
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
  mySharedSessions: [],
  selectedLayersForChat: [],
  selectedFilesForChat: [],
  permissionRequest: null,
  queryResultsPanel: [],
  isQueryPanelOpen: false,
  mapSqlChat: {
    isOpen: false,
    messages: [],
    isLoading: false,
    clickCoords: null,
  },

  clearPermissionRequest: () => set({ permissionRequest: null }),

  addSelectedFile: (path: string) => {
    try {
      const { useDataReferenceStore } = require("@/stores/useDataReferenceStore");
      useDataReferenceStore.getState().syncFromAttachedFiles([path]);
    } catch {}
    set((state) => {
      if (state.selectedFilesForChat.includes(path)) return state;
      return { selectedFilesForChat: [...state.selectedFilesForChat, path] };
    });
  },

  removeSelectedFile: (path: string) => {
    set((state) => ({
      selectedFilesForChat: state.selectedFilesForChat.filter((p) => p !== path)
    }));
  },

  clearSelectedFiles: () => set({ selectedFilesForChat: [] }),

  addQueryResults: (results: QueryResultData[]) => {
    set((state) => ({
      queryResultsPanel: [...results, ...state.queryResultsPanel],
      isQueryPanelOpen: true,
    }));
    
    // Save to Supabase in background (only if <= 10MB; if > 10MB, queryResultService prompts user via toast)
    const { activeSessionId } = get();
    const { user } = useAuthStore.getState();
    if (user && activeSessionId && !activeSessionId.startsWith("shared-")) {
      const dbUserId = user.id;
      for (const result of results) {
        queryResultService
          .saveResult(dbUserId, activeSessionId, result, false)
          .catch((e) => {
            console.error("Background save failed for query result:", e);
          });
      }
    }
  },

  clearQueryResults: () => {
    set({ queryResultsPanel: [], isQueryPanelOpen: false });
    // Remove all duckdb layers from map and clear hover
    const mapStore = useMapStore.getState();
    const filteredFeatures = mapStore.mapFeatures.filter(f => !f.properties?.layerId?.startsWith('duckdb_'));
    mapStore.setMapFeatures(filteredFeatures);
    mapStore.clearVisualizationLayers();
    mapStore.setHoverInfo(null);
    mapStore.setLockedHoverInfo(null);
  },

  removeQueryResult: async (queryId: string) => {
    const auth = useAuthStore.getState();
    const { activeSessionId } = get();
    
    // Optimistic UI update
    set((state) => ({
      queryResultsPanel: state.queryResultsPanel.filter(q => q.queryId !== queryId),
      isQueryPanelOpen: state.queryResultsPanel.length > 1 ? state.isQueryPanelOpen : false
    }));

    // Remove layer from map and clear hover
    const mapStore = useMapStore.getState();
    const layerId = `duckdb_${queryId}`;
    const filteredFeatures = mapStore.mapFeatures.filter(f => f.properties?.layerId !== layerId);
    if (filteredFeatures.length !== mapStore.mapFeatures.length) {
      mapStore.setMapFeatures(filteredFeatures);
    }
    // Also remove visualization layer
    mapStore.removeVisualizationLayer(queryId);
    mapStore.setHoverInfo(null);
    mapStore.setLockedHoverInfo(null);

    if (auth.user && activeSessionId && !activeSessionId.startsWith("shared-")) {
      const dbUserId = auth.user.id;
      try {
        await queryResultService.deleteResult(dbUserId, queryId);
      } catch (error) {
        console.error("Failed to delete query result from Supabase:", error);
      }
    }
  },

  fetchQueryResults: async (sessionId: string) => {
    const auth = useAuthStore.getState();
    if (!auth.user || sessionId.startsWith("shared-")) return;
    
    const dbUserId = auth.user.id;
    try {
      const queryResults = await queryResultService.fetchResultsBySession(dbUserId, sessionId);
      set({ 
        queryResultsPanel: queryResults,
        isQueryPanelOpen: queryResults.length > 0
      });
    } catch (error) {
      console.error("Failed to fetch query results:", error);
    }
  },

  toggleQueryPanel: () => set((state) => ({ isQueryPanelOpen: !state.isQueryPanelOpen })),

  sendMessage: async (text: string) => {
    const auth = useAuthStore.getState();
    if (!auth.user) {
      auth.setAuthModalOpen(true);
      return;
    }

    const currentState = get();
    if (!text.trim() || currentState.isLoading) return;

    if (currentState.activeSessionId?.startsWith("shared-")) {
      toast.error("You are not allowed to do that. Shared sessions are read-only.");
      return;
    }

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
      const { selectedModelId, getSelectedModel, getApiKeyForModel, setSettingsOpen } = useModelSettingsStore.getState();
      const model = getSelectedModel();
      if (!model) throw new Error("No model selected");
      
      const apiKey = getApiKeyForModel(model);
      if (model.requiresApiKey && !apiKey) {
        setSettingsOpen(true);
        const errorMsg = `API key missing for ${model.name}. Please enter your ${model.apiKeyLabel || "API key"} in Settings.`;
        toast.warning(errorMsg);
        throw new Error(errorMsg);
      }

      // Extract active layer summaries if map features are present and not already attached
      const mapStoreFeatures = useMapStore.getState().mapFeatures;
      let activeLayerContext = "";
      if (mapStoreFeatures && mapStoreFeatures.length > 0) {
        const summaries = mapStoreFeatures
          .map((featObj: any, idx: number) => {
            if (!featObj) return null;
            const features = Array.isArray(featObj.features)
              ? featObj.features
              : featObj.type === "Feature"
              ? [featObj]
              : [];
            const count = features.length;
            if (count === 0) return null;

            const sampleFeat = features[0];
            const p = sampleFeat?.properties || {};
            const name = p.name || p.title || p.instruction || p.layerId || `Layer ${idx + 1}`;

            // Inspect up to 10 features to discover columns, sample values, and types
            const sampleSlice = features.slice(0, 10);
            const allKeys = new Set<string>();
            sampleSlice.forEach((f: any) => {
              if (f?.properties) {
                Object.keys(f.properties).forEach((k) => {
                  if (!k.startsWith("_")) allKeys.add(k);
                });
              }
            });

            const colSummaries: string[] = [];
            Array.from(allKeys).slice(0, 12).forEach((col) => {
              const vals = sampleSlice
                .map((f: any) => f?.properties?.[col])
                .filter((v: any) => v !== undefined && v !== null);
              if (vals.length === 0) {
                colSummaries.push(col);
                return;
              }
              const isNumeric = vals.every((v: any) => typeof v === "number" || (!isNaN(Number(v)) && typeof v === "string" && v.trim() !== ""));
              if (isNumeric) {
                const nums = vals.map(Number);
                const min = Math.min(...nums);
                const max = Math.max(...nums);
                colSummaries.push(`${col} (num: ${min}..${max})`);
              } else {
                const distinct = Array.from(new Set(vals.map(String))).slice(0, 3);
                colSummaries.push(`${col} (${distinct.join(", ")})`);
              }
            });

            return `- Layer Index ${idx}: "${name}" | ${count} features | Columns: [${colSummaries.join(", ")}]`;
          })
          .filter(Boolean);

        if (summaries.length > 0) {
          activeLayerContext = `\n\n[ACTIVE_MAP_LAYERS]\nLayers currently displayed on the map:\n${summaries.join("\n")}\nTo style or color any layer, call client tool 'map_style_layer' with layerIndex and style: { type: 'category'|'gradient'|'solid', field: '<col>', valueGroups?: { 'Group': ['Val1', 'Val2'] }, rules?: [...], palette?: 'rainbow'|'traffic'|'ocean'|'heatmap'|'viridis'|'sunset' }.\n[/ACTIVE_MAP_LAYERS]`;
        }
      }

      const rawHistory = get()
        .messages.filter((m) => !m.isLoading);
      const conversationHistory = rawHistory.map((m, idx) => {
        if (
          idx === rawHistory.length - 1 &&
          m.role === "user" &&
          activeLayerContext &&
          !m.content.includes("[ACTIVE_MAP_LAYERS]") &&
          !m.content.includes("[SELECTED_MAP_LAYERS]") &&
          !m.content.includes("[ATTACHED_BOUNDARY_CONTEXT]")
        ) {
          return { role: m.role, content: m.content + activeLayerContext };
        }
        return { role: m.role, content: m.content };
      });
      
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
            console.log("AGENT EVENT RECEIVED:", event);
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

      // Show agent-level errors as distinct toast notifications
      if (finalData.errors && Array.isArray(finalData.errors) && finalData.errors.length > 0) {
        for (const err of finalData.errors) {
          toast.error(`Agent Error (${err.agent})`, {
            description: err.message.length > 150 ? err.message.substring(0, 150) + "..." : err.message,
            duration: 8000,
          });
        }
        console.warn("⚠️ [ChatStore] Agent errors received:", finalData.errors);
      } else {
        toast.success("Received response");
      }

      console.log("💬 [ChatStore] Received finalData from server:", finalData);

      let executionMessages: string[] = [];
      // Execute client tool commands directly (zoom, rotate, etc.) and collect validation results
      if (finalData.clientToolCommands && Array.isArray(finalData.clientToolCommands) && finalData.clientToolCommands.length > 0) {
        // INTERCEPT REQUEST_PERMISSION
        const permissionCmd = finalData.clientToolCommands.find((cmd: any) => cmd.type === "REQUEST_PERMISSION");
        if (permissionCmd && permissionCmd.payload) {
            set({ permissionRequest: permissionCmd.payload });
            // CRITICAL: When permission is pending, do NOT execute ANY other commands.
            // They will be re-generated by the agent on the next turn after user responds.
            console.log("🛡️ [ChatStore] Permission pending — holding back all other commands until user responds.");
        } else {
          // No permission pending — execute all commands normally
          const commandsToExecute = finalData.clientToolCommands.filter((cmd: any) => cmd.type !== "REQUEST_PERMISSION");

          if (commandsToExecute.length > 0) {
            console.log("🛠️ [ChatStore] Executing clientToolCommands:", commandsToExecute);
            const results = await executeClientCommands(commandsToExecute, get().activeSessionId);
            executionMessages = results.map(r => r.success ? `✅ ${r.message}` : `❌ ${r.message}`);
            for (const r of results) {
              if (!r.success) {
                console.error("❌ [ChatStore] Map command failed:", r.message);
                toast.error("Map Action", { description: r.message });
              }
            }
          }
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
        queryResults: finalData.queryResults || undefined,
      };

      // Push query results to the panel (client-only, NOT persisted)
      if (finalData.queryResults && Array.isArray(finalData.queryResults) && finalData.queryResults.length > 0) {
        console.log(`📊 [ChatStore] Received ${finalData.queryResults.length} DuckDB query result(s). Opening panel.`);
        get().addQueryResults(finalData.queryResults);
      }

      set((state) => {
        const updatedSessions = finalData.title
          ? state.sessions.map((s) =>
              s.id === state.activeSessionId ? { ...s, title: finalData.title } : s
            )
          : state.sessions;

        const newState = {
          ...state,
          sessions: updatedSessions,
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
  
  setActiveSession: (id: string) => {
    const state = get();
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;
    set({ activeSessionId: id, messages: session.messages, error: null, isChatOpen: true, isChatMinimized: false });
    // Load layers for this session and render on map
    fetchSessionLayers(id).then((layers) => {
      if (layers.length > 0) {
        useMapStore.getState().setMapFeatures(layers);
        useMapStore.getState().triggerZoomToFit();
        console.log(`[ChatStore] Loaded ${layers.length} persisted layers for session ${id}`);
      } else {
        useMapStore.getState().setMapFeatures([]);
      }
    });
  },
  
  createNewSession: () => {
    const auth = useAuthStore.getState();
    if (!auth.user) {
      auth.setAuthModalOpen(true);
      return;
    }

    set((state) => {
      const newSession: ChatSession = {
        id: generateId(),
        title: "New Chat",
        messages: [],
        updatedAt: Date.now()
      };
      // Clear map when creating a new session
      useMapStore.getState().setMapFeatures([]);
      return {
        sessions: [newSession, ...state.sessions],
        activeSessionId: newSession.id,
        messages: [],
        error: null,
        isChatOpen: true,
        isChatMinimized: false,
        queryResultsPanel: [],
        isQueryPanelOpen: false,
      };
    });
  },

  fetchSessions: async () => {
    const auth = useAuthStore.getState();
    if (!auth.user) return;

    try {
      const fetchPromise = fetch("/api/adk-chat/sessions").then(async res => {
        if (!res.ok) throw new Error("Failed to fetch sessions");
        return res.json();
      });

      const data = await fetchPromise;
      if (data.sessions && Array.isArray(data.sessions)) {
        set((state) => {
          const mergedSessions: ChatSession[] = data.sessions.map((s: any) => {
            const existing = state.sessions.find((es) => es.id === s.id);
            return {
              id: s.id,
              title: s.title || `Chat ${s.id.slice(-6)}`,
              messages: existing ? existing.messages : [],
              updatedAt: s.updatedAt || Date.now(),
            };
          });
          
          // Merge in recently viewed shared sessions from local storage
          const recentShared = getRecentSharedSessions();
          // Filter out any shared sessions already in the list (just in case)
          const newShared = recentShared.filter(rs => !mergedSessions.find(ms => ms.id === rs.id));
          
          return { sessions: [...mergedSessions, ...newShared] };
        });
        
        // Auto-load latest session if no active session is set
        const { activeSessionId, loadSessionHistory } = get();
        if (!activeSessionId && data.sessions.length > 0) {
          await loadSessionHistory(data.sessions[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to fetch ADK sessions:", e);
      toast.error("Failed to fetch chat history");
    }
  },

  loadSessionHistory: async (sessionId: string) => {
    const state = get();
    
    // Redirect to shared session loading if this is a shared session ID
    if (sessionId.startsWith("shared-")) {
      const shareId = sessionId.replace("shared-", "");
      return get().loadSharedSession(shareId);
    }
    
    const existingSession = state.sessions.find(s => s.id === sessionId);
    
    // Serve from cache if messages are already loaded
    if (existingSession && existingSession.messages && existingSession.messages.length > 0) {
      console.log(`[ChatStore] ⚡ Serving chat from cache for session ${sessionId}`);
      set({ 
        isLoading: true, 
        activeSessionId: sessionId,
        messages: existingSession.messages,
        isChatOpen: true,
        isChatMinimized: false
      });
      
      
      const layers = await fetchSessionLayers(sessionId);
      useMapStore.getState().setMapFeatures(layers.length > 0 ? layers : []);
      if (layers.length > 0) useMapStore.getState().triggerZoomToFit();
      
      await get().fetchQueryResults(sessionId);
      
      set({ 
        isLoading: true, 
        activeSessionId: sessionId,
        messages: existingSession.messages,
        isChatOpen: true,
        isChatMinimized: false
      });
      
      set({ isLoading: false });
      return;
    }

    const toastId = toast.loading("Loading session...");
    set({ isLoading: true, activeSessionId: sessionId });
    try {
      const res = await fetch(`/api/adk-chat/sessions/${sessionId}`);
      const data = await res.json();
      if (data.messages) {
        const auth = useAuthStore.getState();
        const dbUserId = auth.user?.id || "";
        const queryResults = dbUserId ? await queryResultService.fetchResultsBySession(dbUserId, sessionId) : [];

        set((state) => {
          const updatedSessions = state.sessions.map((s) =>
            s.id === sessionId ? { ...s, messages: data.messages } : s
          );
          return {
            activeSessionId: sessionId,
            messages: data.messages,
            sessions: updatedSessions,
            isLoading: false,
            isChatOpen: true,
            isChatMinimized: false,
            queryResultsPanel: queryResults,
            isQueryPanelOpen: queryResults.length > 0
          };
        });

        // Load persisted layers for this session and render on map
        const layers = await fetchSessionLayers(sessionId);
        if (layers.length > 0) {
          useMapStore.getState().setMapFeatures(layers);
          useMapStore.getState().triggerZoomToFit();
          console.log(`[ChatStore] Loaded ${layers.length} persisted layers for session ${sessionId}`);
        } else {
          useMapStore.getState().setMapFeatures([]);
        }
        toast.success("Session loaded successfully", { id: toastId });
      } else {
        set({ isLoading: false });
        useMapStore.getState().setMapFeatures([]);
        toast.error("Failed to load session data", { id: toastId });
      }
    } catch (e) {
      console.error("Failed to load ADK session history:", e);
      set({ isLoading: false });
      toast.error("Error loading session", { id: toastId });
    }
  },

  loadSharedSession: async (shareId: string) => {
    const sessionId = `shared-${shareId}`;
    const state = get();
    const existingSession = state.sessions.find(s => s.id === sessionId);

    // Serve from cache if messages are already loaded
    if (existingSession && existingSession.messages && existingSession.messages.length > 0) {
      console.log(`[ChatStore] ⚡ Serving shared chat from cache for session ${sessionId}`);
      
      const layers = await fetchSessionLayers(sessionId);
      useMapStore.getState().setMapFeatures(layers.length > 0 ? layers : []);
      if (layers.length > 0) useMapStore.getState().triggerZoomToFit();
      
      // We must re-fetch query results from the share API if they aren't cached in the state,
      // but since we only cache messages, let's just make a quick fetch for the query results.
      // Or simply set it to empty for now if we want to rely on the API for shared.
      // Let's actually fetch the share API again to get the query results, since they aren't in existingSession!
      const res = await fetch(`/api/adk-chat/share/${shareId}`);
      const data = await res.json();
      
      set({ 
        isLoading: true, 
        activeSessionId: sessionId,
        messages: existingSession.messages,
        isChatOpen: true,
        isChatMinimized: false,
        queryResultsPanel: data.queryResults || [],
        isQueryPanelOpen: data.queryResults && data.queryResults.length > 0
      });
      
      set({ isLoading: false });
      return;
    }

    const toastId = toast.loading("Loading shared session...");
    set({ isLoading: true });
    try {
      const res = await fetch(`/api/adk-chat/share/${shareId}`);
      const data = await res.json();
      if (data.messages) {
        const sessionId = `shared-${shareId}`;

        const sessionToSave = {
          id: sessionId,
          title: data.title || "Shared Chat",
          messages: [],
          updatedAt: data.updatedAt || Date.now(),
        };
        saveRecentSharedSession(sessionToSave);

        set((state) => {
          const existingSession = state.sessions.find(s => s.id === sessionId);
          
          let updatedSessions = state.sessions;
          if (!existingSession) {
            updatedSessions = [
              {
                id: sessionId,
                title: data.title || "Shared Chat",
                messages: data.messages,
                updatedAt: data.updatedAt || Date.now(),
              },
              ...state.sessions
            ];
          } else {
            updatedSessions = state.sessions.map((s) =>
              s.id === sessionId ? { ...s, messages: data.messages } : s
            );
          }

          return {
            activeSessionId: sessionId,
            messages: data.messages,
            sessions: updatedSessions,
            isLoading: false,
            isChatOpen: true,
            isChatMinimized: false,
            queryResultsPanel: data.queryResults || [],
            isQueryPanelOpen: data.queryResults && data.queryResults.length > 0
          };
        });

        // Load shared session layers if available
        if (data.layers && Array.isArray(data.layers) && data.layers.length > 0) {
          setSessionLayersCache(sessionId, data.layers);
          useMapStore.getState().setMapFeatures(data.layers);
          useMapStore.getState().triggerZoomToFit();
          console.log(`[ChatStore] Loaded ${data.layers.length} layers for shared session ${shareId}`);
        } else {
          setSessionLayersCache(sessionId, []);
          useMapStore.getState().setMapFeatures([]);
        }
        toast.success("Shared session loaded", { id: toastId });
      } else {
        set({ isLoading: false });
        toast.error("Failed to load shared session data", { id: toastId });
      }
    } catch (e) {
      console.error("Failed to load shared session:", e);
      set({ isLoading: false });
      toast.error("Error loading shared session", { id: toastId });
    }
  },

  clearSharedSessionCache: (sessionId?: string) => {
    if (sessionId) {
      removeRecentSharedSession(sessionId);
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId)
      }));
      toast.success("Shared session cleared from cache");
    } else {
      clearRecentSharedSessions();
      set((state) => ({
        sessions: state.sessions.filter((s) => !s.id.startsWith("shared-"))
      }));
      toast.success("All shared sessions cleared from cache");
    }
  },

  deleteSession: async (sessionId: string) => {
    const auth = useAuthStore.getState();
    if (!auth.user) {
      auth.setAuthModalOpen(true);
      return;
    }

    if (sessionId.startsWith("shared-")) {
      toast.error("Shared sessions cannot be deleted.");
      return;
    }

    try {
      const deletePromise = (async () => {
        // Delete layers from Supabase first (cascade)
        await deleteAllLayers(sessionId);
        const res = await fetch(`/api/adk-chat/sessions/${sessionId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error("Failed to delete session");
      })();

      toast.promise(deletePromise, {
        loading: "Deleting session...",
        success: "Session deleted successfully",
        error: "Failed to delete session",
      });

      await deletePromise;
      
      set((state) => {
        const filtered = state.sessions.filter(s => s.id !== sessionId);
        const activeSessionId = state.activeSessionId === sessionId 
          ? (filtered.length > 0 ? filtered[0].id : null)
          : state.activeSessionId;
          
        return {
          sessions: filtered,
          activeSessionId,
          messages: activeSessionId === state.activeSessionId ? state.messages : [],
        };
      });
      
      // Auto load the new active session if it changed
      const currentActiveId = get().activeSessionId;
      if (currentActiveId && currentActiveId !== sessionId) {
        get().loadSessionHistory(currentActiveId);
      } else if (!currentActiveId) {
        get().createNewSession();
      }
    } catch (err: any) {
      console.error("Delete session error:", err);
    }
  },

  deleteAllSessions: async () => {
    const auth = useAuthStore.getState();
    if (!auth.user) {
      auth.setAuthModalOpen(true);
      return;
    }

    try {
      // Delete layers for owned sessions first
      const sharedSessions = get().sessions.filter(s => s.id.startsWith("shared-"));
      const ownedSessions = get().sessions.filter(s => !s.id.startsWith("shared-"));

      const deletePromise = (async () => {
        await Promise.all(
          ownedSessions.map(s => deleteAllLayers(s.id).catch(() => {}))
        );
        const res = await fetch(`/api/adk-chat/sessions/all`, { method: 'DELETE' });
        if (!res.ok) throw new Error("Failed to delete all sessions");
      })();

      toast.promise(deletePromise, {
        loading: "Clearing all chats...",
        success: "All your chats have been cleared",
        error: "Failed to clear chats",
      });

      await deletePromise;
      
      useMapStore.getState().setMapFeatures([]);
      set({ sessions: sharedSessions, activeSessionId: null, messages: [] });
      get().createNewSession();
    } catch (err: any) {
      console.error("Delete all sessions error:", err);
    }
  },

  renameSession: async (sessionId: string, newTitle: string) => {
    if (sessionId.startsWith("shared-")) {
      toast.error("Shared sessions cannot be renamed.");
      return;
    }

    // 1. Optimistic UI update
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, title: newTitle } : s
      ),
      mySharedSessions: state.mySharedSessions.map((s) =>
        s.session_id === sessionId ? { ...s, title: newTitle } : s
      ),
    }));

    // 2. Persist in database
    try {
      const renamePromise = fetch(`/api/adk-chat/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      }).then(res => {
        if (!res.ok) throw new Error("Failed to rename");
      });

      toast.promise(renamePromise, {
        loading: "Renaming chat...",
        success: "Chat renamed successfully",
        error: "Failed to rename chat",
      });

      await renamePromise;
    } catch (err) {
      console.error("Failed to persist session rename:", err);
    }
  },

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

  fetchMySharedSessions: async () => {
    try {
      const res = await fetch("/api/adk-chat/share");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          set({ mySharedSessions: data.sharedSessions });
        }
      }
    } catch (err) {
      console.error("Failed to fetch shared sessions:", err);
    }
  },

  toggleShareStatus: async (shareToken: string, isPublic: boolean) => {
    try {
      const res = await fetch(`/api/adk-chat/share/${shareToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: isPublic }),
      });
      if (res.ok) {
        set((state) => ({
          mySharedSessions: state.mySharedSessions.map((s) =>
            s.share_token === shareToken ? { ...s, is_public: isPublic } : s
          ),
        }));
      }
    } catch (err) {
      console.error("Failed to toggle share status:", err);
    }
  },

  shareSession: async (sessionId: string, title?: string) => {
    try {
      const res = await fetch("/api/adk-chat/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, title }),
      });
      const data = await res.json();
      if (data.success && data.shareToken) {
        get().fetchMySharedSessions();
        return data.shareToken;
      }
      return null;
    } catch (err) {
      console.error("Failed to share session:", err);
      return null;
    }
  },

  deleteSharedSession: async (shareToken: string) => {
    try {
      const res = await fetch(`/api/adk-chat/share/${shareToken}`, {
        method: "DELETE",
      });
      if (res.ok) {
        set((state) => ({
          mySharedSessions: state.mySharedSessions.filter(
            (s) => s.share_token !== shareToken
          ),
        }));
      }
    } catch (err) {
      console.error("Failed to delete shared session:", err);
    }
  },
  addSelectedLayer: (layer: any) => {
    set((state) => {
      // Toggle: if already selected (by reference match on first feature), remove it
      const firstFeatId = JSON.stringify(layer?.features?.[0]?.geometry);
      const alreadyIdx = state.selectedLayersForChat.findIndex(
        (l) => JSON.stringify(l?.features?.[0]?.geometry) === firstFeatId
      );
      if (alreadyIdx !== -1) {
        return { selectedLayersForChat: state.selectedLayersForChat.filter((_, i) => i !== alreadyIdx) };
      }
      return { selectedLayersForChat: [...state.selectedLayersForChat, layer] };
    });
  },

  clearSelectedLayers: () => set({ selectedLayersForChat: [] }),

  // ─── Map SQL Floating Chat ────────────────────────────────────
  openMapSqlChat: (coords) => set({
    isChatMinimized: true,
    mapSqlChat: {
      isOpen: true,
      messages: [],
      isLoading: false,
      clickCoords: coords,
    },
  }),

  closeMapSqlChat: () => {
    const { mapSqlChat, messages, activeSessionId } = get();
    if (mapSqlChat.messages.length > 0) {
      const completedMessages = mapSqlChat.messages.filter((m) => !m.isLoading);
      const mergedMessages = [...messages, ...completedMessages];

      set((state) => {
        const newState = {
          ...state,
          messages: mergedMessages,
          isChatMinimized: false,
          isChatOpen: true,
          mapSqlChat: { isOpen: false, messages: [], isLoading: false, clickCoords: null },
        };
        return { ...newState, ...syncSession(newState) };
      });
    } else {
      set({ mapSqlChat: { isOpen: false, messages: [], isLoading: false, clickCoords: null } });
    }
  },

  sendMapSqlMessage: async (text: string, additionalContext?: string) => {
    const auth = useAuthStore.getState();
    if (!auth.user) {
      auth.setAuthModalOpen(true);
      return;
    }

    const currentState = get();
    if (!text.trim() || currentState.mapSqlChat.isLoading) return;

    // Ensure location
    if (!currentState.userLocation) {
      await get().initUserLocation();
    }

    // Ensure active session
    if (!get().activeSessionId) {
      get().createNewSession();
    }

    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };

    const loadingMessage: ChatMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isLoading: true,
    };

    set((state) => ({
      mapSqlChat: {
        ...state.mapSqlChat,
        messages: [...state.mapSqlChat.messages, userMessage, loadingMessage],
        isLoading: true,
      },
    }));

    try {
      const { getSelectedModel, getApiKeyForModel, setSettingsOpen } = useModelSettingsStore.getState();
      const model = getSelectedModel();
      if (!model) throw new Error("No model selected");

      const apiKey = getApiKeyForModel(model);
      if (model.requiresApiKey && !apiKey) {
        setSettingsOpen(true);
        const errorMsg = `API key missing for ${model.name}. Please enter your ${model.apiKeyLabel || "API key"} in Settings.`;
        toast.warning(errorMsg);
        throw new Error(errorMsg);
      }

      const clickCoords = get().mapSqlChat.clickCoords;
      let combinedContext = clickCoords
        ? `\n\n[MAP_SQL_CONTEXT]\nUser right-clicked on map at coordinates: lat=${clickCoords.lat.toFixed(6)}, lng=${clickCoords.lng.toFixed(6)}\nThis is a quick SQL/analysis query from the map context menu. Keep responses concise and focused.\n[/MAP_SQL_CONTEXT]`
        : "";

      if (additionalContext) {
        combinedContext += `\n\n${additionalContext}`;
      }

      const rawHistory = get()
        .mapSqlChat.messages.filter((m) => !m.isLoading);
      const conversationHistory = rawHistory.map((m, idx) => {
        if (idx === rawHistory.length - 1 && m.role === "user") {
          return { role: m.role, content: m.content + combinedContext };
        }
        return { role: m.role, content: m.content };
      });

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
        let apiError = "Failed to get response";
        try { const d = await response.json(); if (d.error) apiError = d.error; } catch {}
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
          try { event = JSON.parse(line); } catch { continue; }

          if (event.type === "stream") {
            set((state) => ({
              mapSqlChat: {
                ...state.mapSqlChat,
                messages: state.mapSqlChat.messages.map((m) =>
                  m.id === loadingMessage.id ? { ...m, content: m.content + event.message } : m
                ),
              },
            }));
          } else if (event.type === "status") {
            set((state) => ({
              mapSqlChat: {
                ...state.mapSqlChat,
                messages: state.mapSqlChat.messages.map((m) =>
                  m.id === loadingMessage.id ? { ...m, statusMessage: event.message } : m
                ),
              },
            }));
          } else if (event.type === "agent_event") {
            set((state) => ({
              mapSqlChat: {
                ...state.mapSqlChat,
                messages: state.mapSqlChat.messages.map((m) =>
                  m.id === loadingMessage.id
                    ? { ...m, agentEvents: [...(m.agentEvents || []), event.event] }
                    : m
                ),
              },
            }));
          } else if (event.type === "result") {
            finalData = event.data;
          } else if (event.type === "error") {
            streamError = event.message;
            break;
          }
        }
        if (streamError) break;
      }

      if (streamError) throw new Error(streamError);
      if (!finalData) throw new Error("No result received.");

      // Execute client commands if any
      if (finalData.clientToolCommands?.length > 0) {
        const { executeClientCommands } = await import("@/lib/mapExecutor");
        const cmds = finalData.clientToolCommands.filter((c: any) => c.type !== "REQUEST_PERMISSION");
        if (cmds.length > 0) await executeClientCommands(cmds, get().activeSessionId);
      }

      // Push query results to panel
      if (finalData.queryResults?.length > 0) {
        get().addQueryResults(finalData.queryResults);
      }

      const streamedContent = get().mapSqlChat.messages.find(m => m.id === loadingMessage.id)?.content || "";
      const content = finalData.content?.text || streamedContent || "*(Task completed)*";

      const assistantMessage: ChatMessage = {
        id: loadingMessage.id,
        role: "assistant",
        content,
        timestamp: Date.now(),
        toolCalls: finalData.toolCalls,
        agentEvents: get().mapSqlChat.messages.find(m => m.id === loadingMessage.id)?.agentEvents,
        usage: finalData.usage,
        isLoading: false,
        queryResults: finalData.queryResults || undefined,
      };

      set((state) => ({
        mapSqlChat: {
          ...state.mapSqlChat,
          messages: state.mapSqlChat.messages.map((m) =>
            m.id === loadingMessage.id ? assistantMessage : m
          ),
          isLoading: false,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to get response";
      toast.error(message);

      const errorMessage: ChatMessage = {
        id: loadingMessage.id,
        role: "assistant",
        content: `### ⚠️ Error\n\n${message}`,
        timestamp: Date.now(),
        isLoading: false,
      };

      set((state) => ({
        mapSqlChat: {
          ...state.mapSqlChat,
          messages: state.mapSqlChat.messages.map((m) =>
            m.id === loadingMessage.id ? errorMessage : m
          ),
          isLoading: false,
        },
      }));
    }
  },
  };
});
