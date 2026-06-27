"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Minimize2, Maximize2 } from "lucide-react";
import { useChatStore } from "@/stores/useChatStore";
import { useModelSettingsStore } from "@/stores/useModelSettingsStore";
import { ChatMessageList } from "./ChatMessageList";

export const ChatOverlay = () => {
  const { isChatOpen, setChatOpen, isChatMinimized, toggleMinimize, messages } = useChatStore();
  const { getSelectedModel } = useModelSettingsStore();
  
  const model = getSelectedModel();
  const aiName = model ? model.name.split(" ")[0] : "AI"; // e.g., "Gemini", "Llama", "GPT-4o"

  return (
    <AnimatePresence>
      {isChatOpen && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 z-20 pointer-events-none"
        >
          <div className="w-full flex flex-col bg-background/70 dark:bg-background/50 backdrop-blur-xl border shadow-2xl rounded-3xl overflow-hidden pointer-events-auto transition-all duration-300">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-background/50">
              <div className="text-xs font-semibold text-foreground/80 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                {aiName}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleMinimize}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  title={isChatMinimized ? "Expand" : "Minimize"}
                >
                  {isChatMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => setChatOpen(false)}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  title="Close chat"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Expandable Body */}
            <motion.div
              initial={false}
              animate={{ 
                height: isChatMinimized ? 0 : "auto",
                maxHeight: isChatMinimized ? 0 : "60vh",
              }}
              className="overflow-hidden"
            >
              <div className="h-[60vh] sm:h-[50vh] max-h-[600px] w-full bg-transparent relative">
                <ChatMessageList messages={messages} aiName={aiName} />
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
