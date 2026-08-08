"use client";

import React, { useState, useEffect, useRef } from "react";
import { FlyToInterpolator, WebMercatorViewport } from "@deck.gl/core";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatOverlay } from "@/components/chat/ChatOverlay";
import { Menu, Layers, Map as MapIcon, Globe, Moon, List, Trash2, GripVertical, X } from "lucide-react";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { useMapStore, BaseMapType } from "@/stores/useMapStore";
import { useChatStore } from "@/stores/useChatStore";
import * as turf from "@turf/turf";
import { deleteLayer as deleteLayerFromSupabase, deleteAllLayers, syncAllLayers } from "@/services/layerSyncService";

import { DeckGLMap } from "./DeckGLMap";

const RAW_GEOMETRY_TYPES = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
];

const normalizeGeoJson = (featureObj: any) => {
  if (!featureObj) return null;
  if (RAW_GEOMETRY_TYPES.includes(featureObj.type)) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: featureObj, properties: {} }],
    };
  }
  if (featureObj.type === "Feature") {
    return { type: "FeatureCollection", features: [featureObj] };
  }
  return featureObj;
};

export const MapWorkspace = () => {
  const { setMobileOpen, layout, isCollapsed, isMobileOpen } = useSidebarStore();
  const setChatOpen = useChatStore(state => state.setChatOpen);
  const baseMap = useMapStore(state => state.baseMap);
  const setBaseMap = useMapStore(state => state.setBaseMap);
  const mapFeatures = useMapStore(state => state.mapFeatures);
  const setMapFeatures = useMapStore(state => state.setMapFeatures);
  const viewState = useMapStore(state => state.viewState);
  const setViewState = useMapStore(state => state.setViewState);
  const setHoverInfo = useMapStore(state => state.setHoverInfo);
  const interactionMode = useMapStore(state => state.interactionMode);
  const selectedLayerIndex = useMapStore(state => state.selectedLayerIndex);
  const setSelectedLayerIndex = useMapStore(state => state.setSelectedLayerIndex);
  const addSelectedLayer = useChatStore(state => state.addSelectedLayer);
  const selectedLayersForChat = useChatStore(state => state.selectedLayersForChat);
  const activeSessionId = useChatStore(state => state.activeSessionId);
  
  const [showBaseMapMenu, setShowBaseMapMenu] = useState(false);
  const [showLayersMenu, setShowLayersMenu] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  
  const [activeLayerDetails, setActiveLayerDetails] = useState<number | null>(null);
  
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const suppressNextLayerClickRef = useRef(false);
  const layoutSignatureRef = useRef(`${layout}:${isCollapsed}:${isMobileOpen}`);

  const getStableCamera = () => {
    const { longitude, latitude, zoom, pitch, bearing } = useMapStore.getState().viewState;
    return { longitude, latitude, zoom, pitch, bearing };
  };

  const fitToGeoJson = (geojson: any) => {
    const normalized = normalizeGeoJson(geojson);
    if (!normalized?.features?.length) return;

    const bbox = turf.bbox(normalized);
    if (bbox.some((value) => !Number.isFinite(value))) return;

    const [minLng, minLat, maxLng, maxLat] = bbox;
    const center = turf.center(normalized).geometry.coordinates;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);

    if (minLng === maxLng && minLat === maxLat) {
      setViewState({
        longitude: center[0],
        latitude: center[1],
        zoom: 18,
        transitionDuration: 800,
        transitionInterpolator: new FlyToInterpolator(),
      });
      return;
    }

    const fitted = new WebMercatorViewport({
      width,
      height,
      longitude: viewState.longitude,
      latitude: viewState.latitude,
      zoom: viewState.zoom,
      pitch: viewState.pitch,
      bearing: viewState.bearing,
    }).fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: Math.min(100, Math.max(32, Math.floor(Math.min(width, height) * 0.12))) },
    );

    setViewState({
      longitude: fitted.longitude,
      latitude: fitted.latitude,
      zoom: Math.min(fitted.zoom, 15),
      transitionDuration: 800,
      transitionInterpolator: new FlyToInterpolator(),
    });
  };

  // Check screen size to enforce desktop-only split mode
  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
    checkDesktop();
    window.addEventListener("resize", checkDesktop);
    return () => window.removeEventListener("resize", checkDesktop);
  }, []);

  const effectiveLayout = (layout === "split" && isDesktop) ? "split" : "floating";

  useEffect(() => {
    const signature = `${effectiveLayout}:${isCollapsed}:${isMobileOpen}`;
    if (layoutSignatureRef.current === signature) return;

    layoutSignatureRef.current = signature;
    const stableCamera = getStableCamera();
    const rafId = window.requestAnimationFrame(() => setViewState(stableCamera));
    const timeoutId = window.setTimeout(() => setViewState(stableCamera), 300);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [effectiveLayout, isCollapsed, isMobileOpen, setViewState]);

  // Automatically open the chat when the layout is set to split
  useEffect(() => {
    if (effectiveLayout === "split") {
      setChatOpen(true);
    }
  }, [effectiveLayout, setChatOpen]);

  const prevFeatureCountRef = useRef(mapFeatures.length);
  useEffect(() => {
    if (mapFeatures.length > prevFeatureCountRef.current) {
      // Zoom to the newly added feature (the last one)
      const latestFeature = mapFeatures[mapFeatures.length - 1];
      if (latestFeature) {
        try {
          fitToGeoJson(latestFeature);
        } catch (e) {
          console.error("Failed to auto-zoom to new layer", e);
        }
      }
    }
    prevFeatureCountRef.current = mapFeatures.length;
  }, [mapFeatures.length]);

  const baseMaps: { id: BaseMapType; name: string; icon: React.ReactNode }[] = [
    { id: "osm", name: "OpenStreetMap", icon: <MapIcon className="w-4 h-4" /> },
    { id: "carto-light", name: "Carto Light", icon: <Layers className="w-4 h-4" /> },
    { id: "carto-dark", name: "Carto Dark", icon: <Moon className="w-4 h-4" /> },
    { id: "satellite", name: "Satellite", icon: <Globe className="w-4 h-4" /> },
  ];

  const handleDragStart = (idx: number) => {
    suppressNextLayerClickRef.current = true;
    setDraggedIdx(idx);
  };
  const handleDragEnter = (idx: number) => {
    setDragOverIdx(idx);
  };
  const handleDragEnd = () => {
    if (activeSessionId?.startsWith("shared-")) {
      import("sonner").then(({ toast }) => toast.error("You are not allowed to do that. Shared sessions are read-only."));
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }

    if (draggedIdx !== null && dragOverIdx !== null && draggedIdx !== dragOverIdx) {
      const stableCamera = getStableCamera();
      const updated = [...mapFeatures];
      const [draggedItem] = updated.splice(draggedIdx, 1);
      updated.splice(dragOverIdx, 0, draggedItem);
      setMapFeatures(updated);
      setViewState(stableCamera);
      window.requestAnimationFrame(() => setViewState(stableCamera));

      if (selectedLayerIndex !== null) {
        if (selectedLayerIndex === draggedIdx) {
          setSelectedLayerIndex(dragOverIdx);
        } else if (draggedIdx < dragOverIdx && selectedLayerIndex > draggedIdx && selectedLayerIndex <= dragOverIdx) {
          setSelectedLayerIndex(selectedLayerIndex - 1);
        } else if (draggedIdx > dragOverIdx && selectedLayerIndex >= dragOverIdx && selectedLayerIndex < draggedIdx) {
          setSelectedLayerIndex(selectedLayerIndex + 1);
        }
      }

    }

    if (draggedIdx !== null) {
      suppressNextLayerClickRef.current = true;
      window.setTimeout(() => {
        suppressNextLayerClickRef.current = false;
      }, 750);
    }

    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  return (
    <main className="relative flex-1 h-full w-full bg-[#f8f9fa] dark:bg-[#0a0a0a] overflow-hidden">
      {/* Interactive Deck.gl Map */}
      <div className="absolute inset-0 z-0">
        <DeckGLMap />
      </div>

        {/* Left Section */}
        <div className="absolute top-4 left-4 flex items-center gap-3 z-20 pointer-events-none">
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

        {/* Nested Features Panel (Left Sidebar) */}
        {activeLayerDetails !== null && normalizeGeoJson(mapFeatures[activeLayerDetails]) && (
          <div className="absolute top-16 left-4 bottom-24 w-64 md:w-72 bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl z-30 flex flex-col overflow-hidden pointer-events-auto animate-in slide-in-from-left-4 fade-in duration-200">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-sm font-semibold truncate flex-1 pr-2">
                {normalizeGeoJson(mapFeatures[activeLayerDetails])?.features?.[0]?.properties?.name || 
                 normalizeGeoJson(mapFeatures[activeLayerDetails])?.features?.[0]?.properties?.title || 
                 `Layer ${activeLayerDetails + 1}`} Features
              </span>
              <button 
                onClick={() => setActiveLayerDetails(null)}
                className="p-1 hover:bg-muted-foreground/20 rounded-md transition-colors text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 py-1">
              {normalizeGeoJson(mapFeatures[activeLayerDetails])!.features.map((f: any, fIdx: number) => {
                const fProps = f.properties || {};
                const fName = fProps.name || fProps.title || fProps.zip || fProps.id || fProps.instruction || `Feature ${fIdx + 1}`;
                return (
                  <div 
                    key={fIdx}
                    className="flex flex-col justify-center px-3 py-1.5 text-[12px] border-b border-border/40 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => {
                      try {
                        fitToGeoJson(f);
                      } catch (e) {
                        console.error("Failed to zoom to feature", e);
                      }
                    }}
                    onDoubleClick={() => {
                      setHoverInfo({
                        props: { ...fProps, _layerIndex: activeLayerDetails, _featureIndex: fIdx },
                        x: window.innerWidth / 2,
                        y: window.innerHeight / 2,
                      });
                    }}
                    title="Click to zoom, Double click for details"
                  >
                    <span className="font-medium truncate text-foreground/80">{fName}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Right Section - Controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-2 pointer-events-auto z-20">
          {/* 2D/3D Toggle */}
          <button
            onClick={() => {
              const is3D = viewState.pitch > 0;
              setViewState({
                ...viewState,
                pitch: is3D ? 0 : 60,
                bearing: is3D ? 0 : viewState.bearing,
                transitionDuration: 500,
                transitionInterpolator: new FlyToInterpolator()
              });
            }}
            className="w-9 h-9 flex items-center justify-center bg-background/80 backdrop-blur-md rounded-md shadow-sm border border-border text-foreground hover:bg-muted transition-colors font-bold text-xs"
            title={viewState.pitch > 0 ? "Map is in 3D (Click to switch to 2D)" : "Map is in 2D (Click to switch to 3D)"}
          >
            {viewState.pitch > 0 ? "3D" : "2D"}
          </button>

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
                      onClick={() => {
                        if (activeSessionId?.startsWith("shared-")) {
                          import("sonner").then(({ toast }) => toast.error("You are not allowed to do that. Shared sessions are read-only."));
                          return;
                        }
                        setMapFeatures([]);
                        setSelectedLayerIndex(null);
                        // Delete all layers from Supabase
                        if (activeSessionId) {
                          deleteAllLayers(activeSessionId).catch((e) =>
                            console.error("[MapWorkspace] Failed to delete all layers from Supabase:", e)
                          );
                        }
                      }}
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
                      const normalized = normalizeGeoJson(featureObj);
                      const firstFeature = normalized?.features?.[0] || null;
                      const props = firstFeature?.properties || {};
                      const layerName = props.name || props.title || props.instruction || `Layer ${idx + 1}`;
                      const isMultiFeature = (normalized?.features?.length || 0) > 1;
                      const isSelectedLayer = selectedLayerIndex === idx;
                      const isSelectedForChat =
                        interactionMode === "SELECT_LAYER" &&
                        selectedLayersForChat.some((l: any) => JSON.stringify(l?.features?.[0]?.geometry) === JSON.stringify(featureObj?.features?.[0]?.geometry));
                      
                      return (
                        <div 
                          key={idx} 
                          draggable
                          onDragStart={() => handleDragStart(idx)}
                          onDragEnter={() => handleDragEnter(idx)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => e.preventDefault()}
                          className={`flex items-center px-2 py-2.5 mb-1.5 mx-2 text-sm text-foreground bg-card border rounded-md shadow-sm transition-all group cursor-pointer
                            ${dragOverIdx === idx ? "border-primary border-t-2 bg-muted/50 scale-[1.02]" : 
                              isSelectedForChat
                                ? "border-green-500 bg-green-500/10 ring-1 ring-green-500/50"
                                : isSelectedLayer
                                  ? "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/50"
                                : "border-border hover:border-primary/40 hover:shadow-md"}
                            ${draggedIdx === idx ? "opacity-50 scale-95" : "opacity-100"}
                          `}
                          onClick={() => {
                            if (suppressNextLayerClickRef.current) {
                              suppressNextLayerClickRef.current = false;
                              return;
                            }

                            setSelectedLayerIndex(idx);

                            // In SELECT_LAYER mode: toggle layer selection for chat, don't zoom
                            if (interactionMode === "SELECT_LAYER") {
                              addSelectedLayer(featureObj);
                              return;
                            }
                            if (isMultiFeature) {
                              setActiveLayerDetails(activeLayerDetails === idx ? null : idx);
                            }
                            if (featureObj) {
                              try {
                                fitToGeoJson(featureObj);
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
                              if (activeSessionId?.startsWith("shared-")) {
                                import("sonner").then(({ toast }) => toast.error("You are not allowed to do that. Shared sessions are read-only."));
                                return;
                              }
                              const updated = [...mapFeatures];
                              updated.splice(idx, 1);
                              setMapFeatures(updated);
                              if (selectedLayerIndex === idx) {
                                setSelectedLayerIndex(null);
                              } else if (selectedLayerIndex !== null && selectedLayerIndex > idx) {
                                setSelectedLayerIndex(selectedLayerIndex - 1);
                              }
                              // Delete this layer from Supabase and re-sync indices
                              if (activeSessionId) {
                                deleteLayerFromSupabase(activeSessionId, idx).catch((e) =>
                                  console.error("[MapWorkspace] Failed to delete layer from Supabase:", e)
                                );
                              }
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
