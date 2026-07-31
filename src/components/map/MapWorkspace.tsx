"use client";

import React, { useState, useEffect } from "react";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatOverlay } from "@/components/chat/ChatOverlay";
import { Menu, Layers, Map as MapIcon, Globe, Moon, List, Trash2, GripVertical } from "lucide-react";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { useMapStore, BaseMapType } from "@/stores/useMapStore";
import { useChatStore } from "@/stores/useChatStore";
import GeoJSON from "ol/format/GeoJSON";
import { createEmpty, extend } from "ol/extent";

import { OpenLayersMap } from "./OpenLayersMap";

export const MapWorkspace = () => {
  const { setMobileOpen, layout } = useSidebarStore();
  const setChatOpen = useChatStore(state => state.setChatOpen);
  const baseMap = useMapStore(state => state.baseMap);
  const setBaseMap = useMapStore(state => state.setBaseMap);
  const mapFeatures = useMapStore(state => state.mapFeatures);
  const setMapFeatures = useMapStore(state => state.setMapFeatures);
  const mapInstance = useMapStore(state => state.mapInstance);
  const setHoverInfo = useMapStore(state => state.setHoverInfo);
  
  const [showBaseMapMenu, setShowBaseMapMenu] = useState(false);
  const [showLayersMenu, setShowLayersMenu] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

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

  const handleDragStart = (idx: number) => {
    setDraggedIdx(idx);
  };
  const handleDragEnter = (idx: number) => {
    setDragOverIdx(idx);
  };
  const handleDragEnd = () => {
    if (draggedIdx !== null && dragOverIdx !== null && draggedIdx !== dragOverIdx) {
      const updated = [...mapFeatures];
      const [draggedItem] = updated.splice(draggedIdx, 1);
      updated.splice(dragOverIdx, 0, draggedItem);
      setMapFeatures(updated);
    }
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

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

        {/* Right Section - Controls */}
        <div className="flex flex-col gap-2 pointer-events-auto relative">
          {/* Base Map Selector */}
          <div className="relative">
            <button
              onClick={() => { setShowBaseMapMenu(!showBaseMapMenu); setShowLayersMenu(false); }}
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

          {/* Active Layers Menu */}
          <div className="relative">
            <button
              onClick={() => { setShowLayersMenu(!showLayersMenu); setShowBaseMapMenu(false); }}
              className="relative p-2 bg-background/80 backdrop-blur-md rounded-md shadow-sm border border-border text-foreground hover:bg-muted transition-colors flex items-center gap-2"
              title="View Added Layers"
            >
              <List className="w-5 h-5" />
              {mapFeatures.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                  {mapFeatures.length}
                </span>
              )}
            </button>

            {showLayersMenu && (
              <div className="absolute top-full right-0 mt-2 w-64 bg-background/95 backdrop-blur-md border border-border rounded-md shadow-lg overflow-hidden flex flex-col py-1 animate-in fade-in zoom-in-95 duration-100 z-50">
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex justify-between items-center">
                  <span>Map Layers</span>
                  {mapFeatures.length > 0 && (
                    <button 
                      onClick={() => setMapFeatures([])}
                      className="text-red-500 hover:text-red-600 text-[10px] capitalize font-medium flex items-center gap-1"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                
                {mapFeatures.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-center text-muted-foreground">
                    No layers added yet.
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20">
                    {mapFeatures.map((featureObj, idx) => {
                      // Extract a readable name
                      const firstFeature = featureObj?.features?.[0] || (featureObj?.type === 'Feature' ? featureObj : null);
                      const props = firstFeature?.properties || {};
                      const layerName = props.name || props.title || props.instruction || `Layer ${idx + 1}`;
                      
                      return (
                        <div 
                          key={idx} 
                          draggable
                          onDragStart={() => handleDragStart(idx)}
                          onDragEnter={() => handleDragEnter(idx)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => e.preventDefault()}
                          className={`flex items-center px-2 py-2.5 mb-1.5 mx-2 text-sm text-foreground bg-card border rounded-md shadow-sm transition-all group cursor-pointer
                            ${dragOverIdx === idx ? "border-primary border-t-2 bg-muted/50 scale-[1.02]" : "border-border hover:border-primary/40 hover:shadow-md"}
                            ${draggedIdx === idx ? "opacity-50 scale-95" : "opacity-100"}
                          `}
                          onClick={() => {
                            if (mapInstance && featureObj) {
                              const geojsonFormat = new GeoJSON();
                              try {
                                const olFeatures = geojsonFormat.readFeatures(featureObj, { featureProjection: "EPSG:3857" });
                                if (olFeatures.length > 0) {
                                  const extent = createEmpty();
                                  olFeatures.forEach((f) => {
                                    const geom = f.getGeometry();
                                    if (geom) extend(extent, geom.getExtent());
                                  });
                                  if (extent && extent[0] !== Infinity) {
                                    mapInstance.getView().fit(extent, {
                                      padding: [100, 100, 100, 100],
                                      duration: 800,
                                      maxZoom: 16,
                                    });
                                  }
                                }
                              } catch (e) {
                                console.error("Failed to zoom to layer", e);
                              }
                            }
                          }}
                          onDoubleClick={() => {
                            if (firstFeature) {
                              setHoverInfo({
                                props: { ...props, _layerIndex: idx },
                                x: window.innerWidth / 2,
                                y: window.innerHeight / 2,
                              });
                            }
                          }}
                          title="Single click to zoom, Double click for details. Drag to reorder."
                        >
                          <div 
                            className="mr-1.5 text-muted-foreground/40 group-hover:text-muted-foreground cursor-grab active:cursor-grabbing"
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                          >
                            <GripVertical className="w-4 h-4" />
                          </div>
                          <span className="truncate flex-1 pr-2 font-medium text-[13px] pointer-events-none">{layerName}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const updated = [...mapFeatures];
                              updated.splice(idx, 1);
                              setMapFeatures(updated);
                            }}
                            className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10"
                            title="Remove Layer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
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
