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
}

export const ALL_MODELS: AIModel[] = [
  // ── Free Models ──────────────────────────────────────────────
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "google",
    description: "Google ka latest fast model. Free tier mein daily 1500 requests.",
    contextWindow: "1M tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Fast",
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    provider: "google",
    description: "Reliable Google model. Free tier available on AI Studio.",
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
    description: "Meta ka open-source model, Groq pe extremely fast inference. Free tier.",
    contextWindow: "128K tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Groq API Key",
    badge: "Fast",
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
  },
  {
    id: "mixtral-8x7b-32768",
    name: "Mixtral 8x7B (Groq)",
    provider: "groq",
    description: "Mistral ka Mixture-of-Experts model. Groq pe free.",
    contextWindow: "32K tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Groq API Key",
  },
  {
    id: "mistral-small-latest",
    name: "Mistral Small",
    provider: "mistral",
    description: "Mistral AI ka efficient model. Free tier available.",
    contextWindow: "32K tokens",
    isFree: true,
    requiresApiKey: true,
    apiKeyLabel: "Mistral API Key",
  },
  {
    id: "ollama/llama3",
    name: "Llama 3 (Ollama Local)",
    provider: "ollama",
    description: "Bilkul free! Aapke apne computer pe chalta hai. Ollama install karna hoga.",
    contextWindow: "8K tokens",
    isFree: true,
    requiresApiKey: false,
    apiKeyLabel: "",
    badge: "Local",
  },

  // ── Paid Models ───────────────────────────────────────────────
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    description: "OpenAI ka flagship multimodal model. Best reasoning capabilities.",
    contextWindow: "128K tokens",
    isFree: false,
    requiresApiKey: true,
    apiKeyLabel: "OpenAI API Key",
    badge: "Powerful",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    description: "GPT-4o ka fast, affordable version. Great value for money.",
    contextWindow: "128K tokens",
    isFree: false,
    requiresApiKey: true,
    apiKeyLabel: "OpenAI API Key",
    badge: "Fast",
  },
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    description: "Anthropic ka best model. Exceptional reasoning aur code generation.",
    contextWindow: "200K tokens",
    isFree: false,
    requiresApiKey: true,
    apiKeyLabel: "Anthropic API Key",
    badge: "Smart",
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "google",
    description: "Google ka most capable model with 1M context window.",
    contextWindow: "1M tokens",
    isFree: false,
    requiresApiKey: true,
    apiKeyLabel: "Google AI Studio API Key",
    badge: "Powerful",
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
      selectedModelId: "gemini-2.0-flash", // Default: free model
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
