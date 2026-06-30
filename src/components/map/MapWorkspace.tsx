"use client";

import React, { useState, useEffect } from "react";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatOverlay } from "@/components/chat/ChatOverlay";
import { Menu, Layers, Map as MapIcon, Globe, Moon } from "lucide-react";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { useMapStore, BaseMapType } from "@/stores/useMapStore";
import { useChatStore } from "@/stores/useChatStore";

import { OpenLayersMap } from "./OpenLayersMap";

export const MapWorkspace = () => {
  const { setMobileOpen, layout } = useSidebarStore();
  const setChatOpen = useChatStore(state => state.setChatOpen);
  const baseMap = useMapStore(state => state.baseMap);
  const setBaseMap = useMapStore(state => state.setBaseMap);
  const [showBaseMapMenu, setShowBaseMapMenu] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  // Check screen size to enforce desktop-only split mode
  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
    checkDesktop();
    window.addEventListener("resize", checkDesktop);
    return () => window.removeEventListener("resize", checkDesktop);
  }, []);

  const effectiveLayout = (layout === "split" && isDesktop) ? "split" : "floating";

  // Automatically open the chat when the layout is set to split
  useEffect(() => {
    if (effectiveLayout === "split") {
      setChatOpen(true);
    }
  }, [effectiveLayout, setChatOpen]);

  const baseMaps: { id: BaseMapType; name: string; icon: React.ReactNode }[] = [
    { id: "osm", name: "OpenStreetMap", icon: <MapIcon className="w-4 h-4" /> },
    { id: "carto-light", name: "Carto Light", icon: <Layers className="w-4 h-4" /> },
    { id: "carto-dark", name: "Carto Dark", icon: <Moon className="w-4 h-4" /> },
    { id: "satellite", name: "Satellite", icon: <Globe className="w-4 h-4" /> },
  ];

  return (
    <main className="relative flex-1 h-full w-full bg-[#f8f9fa] dark:bg-[#0a0a0a] overflow-hidden">
      {/* Interactive OpenLayers Map */}
      <div className="absolute inset-0 z-0">
        <OpenLayersMap />
      </div>

      {/* Top Bar Overlay */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-20 pointer-events-none">
        {/* Left Section */}
        <div className="flex items-center gap-3">
          {/* Mobile Sidebar Toggle */}
          <button 
            onClick={() => setMobileOpen(true)}
            className="md:hidden pointer-events-auto p-2 bg-background/80 backdrop-blur-md rounded-md shadow-sm border text-foreground"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Top Left Logo */}
          <div className="pointer-events-auto font-semibold text-foreground/80 tracking-tight text-lg px-2 drop-shadow-sm">
            MapsenseAI
          </div>
        </div>

        {/* Right Section - Base Map Selector */}
        <div className="pointer-events-auto relative">
          <button
            onClick={() => setShowBaseMapMenu(!showBaseMapMenu)}
            className="p-2 bg-background/80 backdrop-blur-md rounded-md shadow-sm border border-border text-foreground hover:bg-muted transition-colors flex items-center gap-2"
            title="Choose Base Map"
          >
            <Layers className="w-5 h-5" />
          </button>

          {/* Base Map Menu Dropdown */}
          {showBaseMapMenu && (
            <div className="absolute top-full right-0 mt-2 w-48 bg-background/95 backdrop-blur-md border border-border rounded-md shadow-lg overflow-hidden flex flex-col py-1 animate-in fade-in zoom-in-95 duration-100 z-50">
              <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Base Maps
              </div>
              {baseMaps.map((mapOption) => (
                <button
                  key={mapOption.id}
                  onClick={() => {
                    setBaseMap(mapOption.id);
                    setShowBaseMapMenu(false);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors ${
                    baseMap === mapOption.id ? "bg-muted/50 text-primary font-medium" : "text-foreground"
                  }`}
                >
                  {mapOption.icon}
                  {mapOption.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat Panel (Floating / Split) */}
      <div 
        className={`absolute z-20 pointer-events-none flex flex-col justify-end gap-2 ease-in-out top-16 bottom-2 ${
          effectiveLayout === 'split'
            ? 'left-2 w-full max-w-[360px] transition-all duration-500 delay-0' // Translated to left immediately
            : 'left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 transition-all duration-500 delay-300' // Delayed centering
        }`}
      >
        <ChatOverlay isSplit={effectiveLayout === 'split'} />
        <ChatInput />
      </div>
    </main>
  );
};
