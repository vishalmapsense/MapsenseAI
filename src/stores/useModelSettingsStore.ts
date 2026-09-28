/**
 * AI Model Settings Store — Zustand with localStorage persistence
 * ─────────────────────────────────────────────────────────────
 * User ke selected model aur API keys yahan store hote hain.
 * localStorage mein persist hota hai — page reload pe bhi yaad rehta hai.
 * ─────────────────────────────────────────────────────────────
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Model Definitions ─────────────────────────────────────────

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "mistral"
  | "openrouter"
  | "ollama";

export interface AIModel {
  id: string;
  name: string;
  provider: ModelProvider;
  description: string;
  contextWindow: string;
  isFree: boolean;
  requiresApiKey: boolean;
  apiKeyLabel: string;
  badge?: "Fast" | "Smart" | "Local" | "Powerful";
  isDisabled?: boolean;
}

export const ALL_MODELS: AIModel[] = [
  // ── Google Gemini Models (Direct AI Studio Integration) ───────────
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "google",
    description: "Google's latest flagship flash model with high rate limits and fast, intelligent multimodal reasoning.",
    contextWindow: "1M tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Smart",
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    provider: "google",
    description: "Ultra-fast, high-throughput model with generous free quotas. Best for quick geospatial tasks.",
    contextWindow: "1M tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Fast",
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    provider: "google",
    description: "Lightweight Gemini 3.1 model optimized for simple workflows.",
    contextWindow: "1M tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Fast",
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    provider: "google",
    description: "High-performance Gemini 3.8 model with state-of-the-art reasoning.",
    contextWindow: "1M tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Powerful",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    description: "Legacy 2.5 model. Note: Google AI Studio restricts this model to only 20 requests/day on the free tier.",
    contextWindow: "1M tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Fast",
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    provider: "google",
    description: "Google's advanced reasoning model for deep analysis and complex workflows.",
    contextWindow: "2M tokens",
    isFree: false,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Smart",
  },

  // ── Open Source & Alternate Providers ─────────────────────────
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B (Groq)",
    provider: "groq",
    description: "Meta's open-source model, extremely fast inference on Groq. Free tier.",
    contextWindow: "128K tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Groq API Key",
    badge: "Fast",
    isDisabled: true,
  },
  {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant (Groq)",
    provider: "groq",
    description: "Ultra-fast small model on Groq. Best for simple queries. Free.",
    contextWindow: "128K tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Groq API Key",
    badge: "Fast",
    isDisabled: true,
  },
  {
    id: "mixtral-8x7b-32768",
    name: "Mixtral 8x7B (Groq)",
    provider: "groq",
    description: "Mistral's Mixture-of-Experts model. Free on Groq.",
    contextWindow: "32K tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Groq API Key",
    isDisabled: true,
  },
  {
    id: "mistral-small-latest",
    name: "Mistral Small",
    provider: "mistral",
    description: "Mistral AI's efficient model. Free tier available.",
    contextWindow: "32K tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Mistral API Key",
    isDisabled: true,
  },
  {
    id: "ollama/llama3",
    name: "Llama 3 (Ollama Local)",
    provider: "ollama",
    description: "Completely free! Runs locally on your own computer. Requires Ollama.",
    contextWindow: "8K tokens",
    isFree: true,
    requiresApiKey: false,
    apiKeyLabel: "",
    badge: "Local",
    isDisabled: true,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    description: "OpenAI's flagship multimodal model. Best reasoning capabilities.",
    contextWindow: "128K tokens",
    isFree: false,
    requiresApiKey: true,
    apiKeyLabel: "OpenAI API Key",
    badge: "Powerful",
    isDisabled: true,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    description: "Fast, affordable version of GPT-4o. Great value for money.",
    contextWindow: "128K tokens",
    isFree: false,
    requiresApiKey: true,
    apiKeyLabel: "OpenAI API Key",
    badge: "Fast",
    isDisabled: true,
  },
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    description: "Anthropic's best model. Exceptional reasoning and code generation.",
    contextWindow: "200K tokens",
    isFree: false,
    requiresApiKey: true,
    apiKeyLabel: "Anthropic API Key",
    badge: "Smart",
    isDisabled: true,
  },
];

// ─── Provider API Key Labels ───────────────────────────────────

export const PROVIDER_API_KEY_URLS: Record<ModelProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/keys",
  google: "https://aistudio.google.com/apikey",
  groq: "https://console.groq.com/keys",
  mistral: "https://console.mistral.ai/api-keys",
  openrouter: "https://openrouter.ai/keys",
  ollama: "",
};

// ─── Settings Store ────────────────────────────────────────────

interface ModelSettingsState {
  selectedModelId: string;
  apiKeys: Partial<Record<ModelProvider, string>>;
  ollamaBaseUrl: string;
  isSettingsOpen: boolean;

  setSelectedModel: (id: string) => void;
  setApiKey: (provider: ModelProvider, key: string) => void;
  setOllamaBaseUrl: (url: string) => void;
  setSettingsOpen: (open: boolean) => void;
  getSelectedModel: () => AIModel | undefined;
  getApiKeyForModel: (model: AIModel) => string;
}

export const useModelSettingsStore = create<ModelSettingsState>()(
  persist(
    (set, get) => ({
      selectedModelId: "gemini-3.5-flash", // Default: high-quota flash model
      apiKeys: {},
      ollamaBaseUrl: "http://localhost:11434",
      isSettingsOpen: false,

      setSelectedModel: (id) => set({ selectedModelId: id }),

      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key },
        })),

      setOllamaBaseUrl: (url) => set({ ollamaBaseUrl: url }),

      setSettingsOpen: (open) => set({ isSettingsOpen: open }),

      getSelectedModel: () => {
        const { selectedModelId } = get();
        // Automatically migrate away from 20 req/day limited gemini-2.5-flash
        const effectiveId =
          selectedModelId === "gemini-2.5-flash"
            ? "gemini-3.5-flash"
            : selectedModelId;
        return (
          ALL_MODELS.find((m) => m.id === effectiveId) ||
          ALL_MODELS[0]
        );
      },

      getApiKeyForModel: (model) => {
        const { apiKeys } = get();
        return (apiKeys[model.provider] ?? "").trim();
      },
    }),
    {
      name: "mapsense-model-settings",
      // Exclude ephemeral isSettingsOpen from persisted localStorage
      partialize: (state) => ({
        selectedModelId: state.selectedModelId,
        apiKeys: state.apiKeys,
        ollamaBaseUrl: state.ollamaBaseUrl,
      }),
    }
  )
);
