"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Minimize2, Maximize2, PanelLeft, AppWindow, Ghost } from "lucide-react";
import { useChatStore } from "@/stores/useChatStore";
import { useModelSettingsStore } from "@/stores/useModelSettingsStore";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ChatMessageList } from "./ChatMessageList";

export const ChatOverlay = ({ isSplit = false }: { isSplit?: boolean }) => {
  const { isChatOpen, setChatOpen, isChatMinimized, toggleMinimize, isTransparentMode, toggleTransparentMode, messages, initUserLocation } = useChatStore();
  const { getSelectedModel } = useModelSettingsStore();
  const { layout, setLayout } = useSidebarStore();

  // Request user location once when chat becomes visible
  React.useEffect(() => {
    if (isChatOpen) {
      initUserLocation();
    }
  }, [isChatOpen, initUserLocation]);

  const model = getSelectedModel();
  const aiName = model ? model.name.split(" ")[0] : "AI"; // e.g., "Gemini", "Llama", "GPT-4o"

  return (
    <AnimatePresence>
      {isChatOpen && (
        <motion.div
          initial={!isSplit ? { opacity: 0, y: 20, scale: 0.95 } : { opacity: 0 }}
          animate={!isSplit ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1 }}
          exit={!isSplit ? { opacity: 0, y: 20, scale: 0.95 } : { opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="w-full z-20 pointer-events-none"
        >
          <div className={`w-full flex flex-col pointer-events-auto transition-all duration-300 rounded-3xl overflow-hidden ${isTransparentMode ? 'bg-transparent border-transparent shadow-none' : 'bg-background/10 dark:bg-background/10 backdrop-blur-xs border'}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-background/50">
              <div className="text-xs font-semibold text-foreground/80 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                {aiName}
              </div>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    onClick={toggleTransparentMode}
                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
                  >
                    <Ghost className={`w-3.5 h-3.5 ${isTransparentMode ? 'text-primary' : ''}`} />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {isTransparentMode ? "Solid Mode" : "Transparent Mode"}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger
                    onClick={() => setLayout(layout === "split" ? "floating" : "split")}
                    className="hidden md:flex p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  >
                    {layout === "split" ? <AppWindow className="w-3.5 h-3.5" /> : <PanelLeft className="w-3.5 h-3.5" />}
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {layout === "split" ? "Floating Layout" : "Split Layout"}
                  </TooltipContent>
                </Tooltip>
                
                <Tooltip>
                  <TooltipTrigger
                    onClick={toggleMinimize}
                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  >
                    {isChatMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {isChatMinimized ? "Expand" : "Minimize"}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger
                    onClick={() => setChatOpen(false)}
                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Close
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Expandable Body */}
            <motion.div
              initial={false}
              animate={{
                height: isChatMinimized ? 0 : "auto",
              }}
              className="overflow-hidden flex flex-col"
            >
              <div className={`w-full bg-transparent relative ${
                isSplit 
                  ? 'h-[75vh] max-h-[800px] transition-all duration-300 delay-500' // Delayed height increase
                  : 'h-[60vh] sm:h-[50vh] max-h-[600px] transition-all duration-300 delay-0' // Immediate height decrease
              }`}>
                <ChatMessageList messages={messages} aiName={aiName} />
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
