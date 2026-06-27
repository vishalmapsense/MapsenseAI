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
  // ── Free Models ──────────────────────────────────────────────
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "google",
    description: "Google's latest and fastest model. Perfect for quick and reliable responses.",
    contextWindow: "1M tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Fast",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    description: "Highly capable Google model for everyday tasks with a large context window.",
    contextWindow: "1M tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Fast",
  },
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

  // ── Paid Models ───────────────────────────────────────────────
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
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    provider: "google",
    description: "Lightweight model designed for simple and fast tasks.",
    contextWindow: "1M tokens",
    isFree: false,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Fast",
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

  setSelectedModel: (id: string) => void;
  setApiKey: (provider: ModelProvider, key: string) => void;
  setOllamaBaseUrl: (url: string) => void;
  getSelectedModel: () => AIModel | undefined;
  getApiKeyForModel: (model: AIModel) => string;
}

export const useModelSettingsStore = create<ModelSettingsState>()(
  persist(
    (set, get) => ({
      selectedModelId: "gemini-3.5-flash", // Default: free model
      apiKeys: {},
      ollamaBaseUrl: "http://localhost:11434",

      setSelectedModel: (id) => set({ selectedModelId: id }),

      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key },
        })),

      setOllamaBaseUrl: (url) => set({ ollamaBaseUrl: url }),

      getSelectedModel: () => {
        const { selectedModelId } = get();
        return ALL_MODELS.find((m) => m.id === selectedModelId);
      },

      getApiKeyForModel: (model) => {
        const { apiKeys } = get();
        return apiKeys[model.provider] ?? "";
      },
    }),
    {
      name: "mapsense-model-settings",
      // API keys are sensitive — stored in localStorage only
      // For production: consider encryption or server-side storage
    }
  )
);
