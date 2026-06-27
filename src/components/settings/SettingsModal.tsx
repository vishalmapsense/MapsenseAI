"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Eye,
  EyeOff,
  ExternalLink,
  Check,
  Zap,
  Globe,
  Cpu,
  Brain,
  Key,
  Palette,
  Settings,
  User,
  Sparkles,
} from "lucide-react";
import {
  ALL_MODELS,
  PROVIDER_API_KEY_URLS,
  useModelSettingsStore,
  type AIModel,
  type ModelProvider,
} from "@/stores/useModelSettingsStore";

// ─── Provider Icons ───────────────────────────────────────────

const PROVIDER_COLORS: Record<ModelProvider, string> = {
  openai: "from-emerald-500 to-teal-600",
  anthropic: "from-orange-500 to-amber-600",
  google: "from-blue-500 to-indigo-600",
  groq: "from-violet-500 to-purple-600",
  mistral: "from-fuchsia-500 to-pink-600",
  openrouter: "from-slate-500 to-zinc-600",
  ollama: "from-gray-500 to-gray-700",
};

function ProviderIcon({ provider, className }: { provider: ModelProvider; className?: string }) {
  switch (provider) {
    case "openai":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M22.281 10.456a6.836 6.836 0 0 0-.256-4.593 6.914 6.914 0 0 0-4.303-3.834 6.84 6.84 0 0 0-5.744.57 6.88 6.88 0 0 0-6.19-2.316 6.902 6.902 0 0 0-5.412 3.197 6.846 6.846 0 0 0-1.848 5.61A6.924 6.924 0 0 0 .1 15.658a6.848 6.848 0 0 0 4.14 3.905 6.837 6.837 0 0 0 5.61-.41 6.87 6.87 0 0 0 6.22 2.375 6.9 6.9 0 0 0 5.485-3.13 6.85 6.85 0 0 0 1.847-5.592c-.347-.116-.708-.21-1.076-.277a6.83 6.83 0 0 0-.046-.073Zm-4.99 4.316-2.128-1.229 2.127-1.229c.148-.085.239-.243.239-.413V9.444c0-.23-.153-.435-.37-.5-.218-.066-.45.025-.572.222l-2.115 3.425v2.464l2.115 1.229c.137.08.31.08.448 0l2.128-1.229c.137-.08.223-.228.223-.387v-2.458c0-.159-.086-.307-.223-.387l-1.872-1.082ZM8.6 15.53l-2.114 1.22 2.114 1.22c.137.08.31.08.448 0l2.127-1.229c.138-.08.224-.228.224-.387v-2.458c0-.159-.086-.307-.224-.387L9.048 12.42 6.933 8.995c-.12-.197-.354-.288-.57-.222a.533.533 0 0 0-.372.5v2.458c0 .17.09.328.24.413l2.128 1.229 2.127 1.229c.138.08.224.228.224.387v1.541ZM12 4.142l2.114 1.22v2.44L12 9.02l-2.114-1.22v-2.44L12 4.142Zm3.197 9.873-2.114-1.22v-2.44l2.114-1.22 2.115 1.22v2.44l-2.115 1.22Zm-6.394 0-2.115-1.22v-2.44l2.115-1.22 2.114 1.22v2.44l-2.114 1.22Zm6.425 2.17 2.114-1.22 2.127 3.425c.122.197.027.45-.19.572a.53.53 0 0 1-.502-.07L12.935 15.6v-2.458c0-.16.086-.307.224-.387l2.114-1.22V10.3l-2.128-1.229c-.148-.085-.32-.085-.468 0L10.55 10.3v1.234l-2.114 1.22v2.44l-1.077 1.745c-.12.197-.027.45.19.57a.53.53 0 0 0 .502-.07l3.882-2.24v2.458c0 .16.086.307.224.387l2.115 1.22V16.185Zm-9.61-4.34-2.115-1.22 1.077-1.745c.12-.197.354-.288.57-.22a.53.53 0 0 1 .37.5v2.458c0 .16.086.307.224.387l2.114 1.22 2.115 1.22v2.44L8.8 19.345c-.138.08-.31.08-.448 0l-2.127-1.229a.447.447 0 0 1-.224-.387v-2.458c0-.16.086-.307.224-.387l2.115-1.22V12.445l-2.114-1.22Z" />
        </svg>
      );
    case "anthropic":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M17.44 2.05L21.95 21.9h-3.95l-1.07-4.88H8.8l-1.07 4.88H3.8l4.5-19.85h9.14ZM11.16 6.36l-1.8 8.16h6.8l-1.8-8.16h-3.2Z" />
        </svg>
      );
    case "google":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M12 2C12 7.52 16.48 12 22 12C16.48 12 12 16.48 12 22C12 16.48 7.52 12 2 12C7.52 12 12 7.52 12 2Z" />
        </svg>
      );
    case "groq":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
    case "mistral":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21V3l9 12 9-12v18" />
        </svg>
      );
    case "openrouter":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10Zm-1.815-12.012c-.528.26-.874.808-.874 1.412a1.59 1.59 0 0 0 3.178.019c0-.604-.346-1.151-.874-1.411V7h-1.43v2.988Zm3.307 2.385-1.238.715v1.43l1.246-.72a1.59 1.59 0 1 0-.008-1.425ZM9.27 12.385a1.59 1.59 0 1 0-.009 1.425l1.247.72v-1.43l-1.238-.715Z" />
        </svg>
      );
    case "ollama":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M7.5 2C6.67 2 6 2.67 6 3.5v5c0 .7.46 1.3 1.1 1.45V15c0 1.66-1.34 3-3 3v2c2.76 0 5-2.24 5-5v-1h5.8c.6 1.7 2.2 3 4.1 3 2.5 0 4.5-2 4.5-4.5 0-1.9-1.2-3.6-2.9-4.2V3.5C20.6 2.67 19.93 2 19.1 2h-1.6c-.83 0-1.5.67-1.5 1.5V6H9V3.5C9 2.67 8.33 2 7.5 2z" />
        </svg>
      );
  }
}

const BADGE_STYLES: Record<string, string> = {
  Fast: "bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/20",
  Smart: "bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/20",
  Local: "bg-violet-50 text-violet-600 border border-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/20",
  Powerful: "bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/20",
};

// ─── API Key Input ─────────────────────────────────────────────

function ApiKeyInput({
  provider,
  label,
  docUrl,
}: {
  provider: ModelProvider;
  label: string;
  docUrl: string;
}) {
  const { apiKeys, setApiKey } = useModelSettingsStore();
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const value = apiKeys[provider] ?? "";

  const handleSave = useCallback(
    (newVal: string) => {
      setApiKey(provider, newVal);
      if (newVal) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    },
    [provider, setApiKey]
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</label>
        {docUrl && (
          <a
            href={docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            Get API Key <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => handleSave(e.target.value)}
          placeholder={`sk-...`}
          className="w-full bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-700/60 rounded-lg px-3 py-2 pr-20 text-sm text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/60 focus:bg-zinc-50 dark:focus:bg-zinc-900 transition-all"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          <AnimatePresence mode="wait">
            {saved && (
              <motion.div
                key="saved"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-1 text-emerald-500 dark:text-emerald-400 text-[11px] font-medium"
              >
                <Check className="w-3 h-3" /> Saved
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={() => setVisible((v) => !v)}
            className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors p-0.5"
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Model Card ────────────────────────────────────────────────

function ModelCard({
  model,
  isSelected,
  onSelect,
}: {
  model: AIModel;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isDisabled = model.isDisabled;

  return (
    <motion.div
      whileHover={!isDisabled ? { scale: 1.01 } : undefined}
      whileTap={!isDisabled ? { scale: 0.99 } : undefined}
      transition={{ duration: 0.15 }}
      onClick={!isDisabled ? onSelect : undefined}
      className={`
        w-full text-left rounded-xl p-2.5 border transition-all duration-200 
        ${isDisabled ? "opacity-50 cursor-not-allowed grayscale-[50%]" : "cursor-pointer"}
        ${
          isSelected
            ? "border-blue-500/60 bg-blue-50 dark:bg-blue-500/8 shadow-sm shadow-blue-500/10"
            : isDisabled
            ? "border-zinc-200 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/20"
            : "border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/40 hover:border-zinc-300 dark:hover:border-zinc-700/80 hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
        }
      `}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`w-7 h-7 rounded-lg bg-gradient-to-br ${PROVIDER_COLORS[model.provider]} flex items-center justify-center text-white shrink-0 mt-0.5`}
        >
          <ProviderIcon provider={model.provider} className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{model.name}</span>
            {model.badge && !isDisabled && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${BADGE_STYLES[model.badge]}`}>
                {model.badge}
              </span>
            )}
            {model.isFree && !isDisabled && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                FREE
              </span>
            )}
            {isDisabled && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700">
                Coming Soon
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 line-clamp-1 leading-relaxed mt-0.5">
            {model.description}
          </p>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] text-zinc-500 dark:text-zinc-600 flex items-center gap-1">
              <Cpu className="w-3 h-3" /> {model.contextWindow}
            </span>
            {!model.requiresApiKey && (
              <span className="text-[10px] text-zinc-500 dark:text-zinc-600 flex items-center gap-1">
                <Globe className="w-3 h-3" /> No API key needed
              </span>
            )}
          </div>
        </div>

        <div
          className={`w-4 h-4 rounded-full border-2 shrink-0 mt-1 flex items-center justify-center transition-all
            ${isSelected ? "border-blue-500 bg-blue-500" : "border-zinc-300 dark:border-zinc-700"}`}
        >
          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Settings Modal ───────────────────────────────────────

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "general" | "models" | "apikeys" | "theme" | "account";

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>("models");
  const [filter, setFilter] = useState<"all" | "free" | "paid">("all");
  const { selectedModelId, setSelectedModel } = useModelSettingsStore();

  const filteredModels = ALL_MODELS.filter((m) => {
    if (filter === "free") return m.isFree;
    if (filter === "paid") return !m.isFree;
    return true;
  });

  const providersNeedingKeys = [
    ...new Set(
      ALL_MODELS.filter((m) => m.requiresApiKey).map((m) => m.provider)
    ),
  ] as ModelProvider[];

  const selectedModel = ALL_MODELS.find((m) => m.id === selectedModelId);

  // Sidebar Menu Items
  const MENU_ITEMS = [
    { id: "general", label: "General", icon: Settings },
    { id: "models", label: "LLM Models", icon: Brain },
    { id: "apikeys", label: "API Keys", icon: Key },
    { id: "theme", label: "Appearance", icon: Palette },
    { id: "account", label: "Account", icon: User },
  ] as const;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-4xl h-[85vh] flex bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl shadow-xl dark:shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Left Sidebar */}
              <div className="w-56 bg-zinc-50 dark:bg-zinc-900/40 border-r border-zinc-200 dark:border-zinc-800/60 flex flex-col">
                <div className="p-5 pb-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Settings
                  </h2>
                </div>
                <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                  {MENU_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = tab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setTab(item.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                          isActive
                            ? "bg-blue-500 text-white shadow-sm shadow-blue-500/20"
                            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-200"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Main Content Area */}
              <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-950">
                {/* Header Actions */}
                <div className="flex items-center justify-end px-8 py-4">
                  <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800/60 transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-8 pb-8">
                  <AnimatePresence mode="wait">
                    
                    {/* ── Models Tab ── */}
                    {tab === "models" && (
                      <motion.div
                        key="models"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <div>
                          <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                            LLM Models
                          </h3>
                          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
                            Choose the language model you want to power Mapsense AI.
                          </p>
                        </div>

                        {selectedModel && (
                          <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50/50 border border-blue-100 dark:bg-blue-500/5 dark:border-blue-500/10">
                            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${PROVIDER_COLORS[selectedModel.provider]} flex items-center justify-center text-white shrink-0`}>
                              <ProviderIcon provider={selectedModel.provider} className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs text-blue-600 dark:text-blue-400/80 uppercase tracking-wider font-semibold">Active Model</span>
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-200">{selectedModel.name}</p>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-2 mb-4">
                          {(["all", "free", "paid"] as const).map((f) => (
                            <button
                              key={f}
                              onClick={() => setFilter(f)}
                              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                                filter === f
                                  ? f === "free"
                                    ? "bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30"
                                    : "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-200"
                                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:text-zinc-400"
                              }`}
                            >
                              {f === "all" ? "All Models" : f === "free" ? (
                                <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> Free Models</span>
                              ) : "Premium"}
                            </button>
                          ))}
                        </div>

                        {/* Free section */}
                        {filter !== "paid" && (
                          <div className="space-y-2 mt-2">
                            {filteredModels
                              .filter((m) => m.isFree)
                              .map((model) => (
                                <ModelCard
                                  key={model.id}
                                  model={model}
                                  isSelected={selectedModelId === model.id}
                                  onSelect={() => setSelectedModel(model.id)}
                                />
                              ))}
                          </div>
                        )}

                        {/* Paid section */}
                        {filter !== "free" && filteredModels.some((m) => !m.isFree) && (
                          <>
                            <div className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3 mt-8 flex items-center gap-1.5">
                              Premium Models
                            </div>
                            <div className="space-y-2">
                              {filteredModels
                                .filter((m) => !m.isFree)
                                .map((model) => (
                                  <ModelCard
                                    key={model.id}
                                    model={model}
                                    isSelected={selectedModelId === model.id}
                                    onSelect={() => setSelectedModel(model.id)}
                                  />
                                ))}
                            </div>
                          </>
                        )}
                      </motion.div>
                    )}

                    {/* ── API Keys Tab ── */}
                    {tab === "apikeys" && (
                      <motion.div
                        key="apikeys"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <div>
                          <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                            API Keys
                          </h3>
                          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
                            Manage API keys for different model providers. Stored securely in your browser.
                          </p>
                        </div>

                        <div className="space-y-6 max-w-2xl">
                          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border-blue-100 dark:bg-blue-500/8 border dark:border-blue-500/15">
                            <div className="text-blue-500 dark:text-blue-400 mt-0.5">ℹ️</div>
                            <p className="text-[11px] text-blue-700 dark:text-blue-300/80 leading-relaxed">
                              API keys are stored safely in your browser (localStorage). They are never sent to any external servers other than the LLM provider directly.
                            </p>
                          </div>

                          {providersNeedingKeys.map((provider) => {
                            const providerModels = ALL_MODELS.filter(
                              (m) => m.provider === provider && m.requiresApiKey
                            );
                            const sampleModel = providerModels[0];
                            return (
                              <div key={provider} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/30">
                                <div className="flex items-center gap-3 mb-4">
                                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${PROVIDER_COLORS[provider]} flex items-center justify-center text-white`}>
                                    <ProviderIcon provider={provider} className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 capitalize">
                                      {provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : provider === "google" ? "Google AI Studio" : provider.charAt(0).toUpperCase() + provider.slice(1)}
                                    </p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                      Supports: {providerModels.map((m) => m.name).join(", ")}
                                    </p>
                                  </div>
                                </div>
                                <ApiKeyInput
                                  provider={provider}
                                  label={sampleModel?.apiKeyLabel ?? `${provider} API Key`}
                                  docUrl={PROVIDER_API_KEY_URLS[provider]}
                                />
                              </div>
                            );
                          })}

                          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/30">
                            <div className="flex items-center gap-3 mb-4">
                              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center text-white">
                                <ProviderIcon provider="ollama" className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">Ollama (Local)</p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">Completely free! No API key required.</p>
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Ollama Base URL</label>
                              <input
                                type="text"
                                defaultValue="http://localhost:11434"
                                className="w-full bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-blue-500/60 transition-all"
                              />
                            </div>
                            <a
                              href="https://ollama.com"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors mt-3"
                            >
                              Install Ollama → ollama.com <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* ── Theme / General Placeholders ── */}
                    {["theme", "general", "account"].includes(tab) && (
                      <motion.div
                        key="placeholder"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="flex flex-col items-center justify-center h-64 text-center"
                      >
                        <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 dark:text-zinc-600 mb-4">
                          {tab === "theme" && <Palette className="w-8 h-8" />}
                          {tab === "general" && <Settings className="w-8 h-8" />}
                          {tab === "account" && <User className="w-8 h-8" />}
                        </div>
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-200 capitalize">
                          {tab === "theme" ? "Appearance" : tab} Settings
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 max-w-sm">
                          This section is coming soon. You'll be able to configure {tab} preferences here.
                        </p>
                      </motion.div>
                    )}

                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
