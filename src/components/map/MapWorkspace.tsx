"use client";

import React from "react";
import { ChatInput } from "@/components/chat/ChatInput";
import { Menu } from "lucide-react";
import { useSidebarStore } from "@/stores/useSidebarStore";

export const MapWorkspace = () => {
  const { setMobileOpen } = useSidebarStore();

  return (
    <main className="relative flex-1 h-full w-full bg-[#f8f9fa] dark:bg-[#0a0a0a] overflow-hidden">
      {/* 
        Map Placeholder Layer 
        In the future, OpenLayers/Deck.gl instances will mount here.
      */}
      <div className="absolute inset-0 z-0">
        <div className="w-full h-full border-[2px] border-dashed border-border/40 flex items-center justify-center text-muted-foreground/50">
          Interactive Map Area
        </div>
      </div>

      {/* Top Bar Overlay */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center gap-3 z-10 pointer-events-none">
        {/* Mobile Sidebar Toggle */}
        <button 
          onClick={() => setMobileOpen(true)}
          className="md:hidden pointer-events-auto p-2 bg-background/80 backdrop-blur-md rounded-md shadow-sm border text-foreground"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Top Left Logo */}
        <div className="pointer-events-auto font-semibold text-foreground/80 tracking-tight text-lg px-2">
          MapsenseAI
        </div>
      </div>

      {/* Chat Input Overlay */}
      <ChatInput />
    </main>
  );
};
