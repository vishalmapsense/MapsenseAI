"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { FlyToInterpolator, WebMercatorViewport } from "@deck.gl/core";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatOverlay } from "@/components/chat/ChatOverlay";
import { Menu, Layers, Map as MapIcon, Globe, Moon, List, Trash2, GripVertical, X, Table2, Shapes, SlidersHorizontal, Sparkles, Search, Eye, EyeOff, Paintbrush } from "lucide-react";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { useMapStore, BaseMapType } from "@/stores/useMapStore";
import { useChatStore } from "@/stores/useChatStore";
import * as turf from "@turf/turf";
import { deleteLayer as deleteLayerFromSupabase, deleteAllLayers, syncAllLayers } from "@/services/layerSyncService";

import { DeckGLMap } from "./DeckGLMap";
import { QueryResultsPanel } from "./QueryResultsPanel";
import { LayerConfigPanel } from "./LayerConfigPanel";
import { LayerStylePanel } from "./LayerStylePanel";
import { ALL_LAYER_TYPES, getApplicableLayerTypes } from "@/utils/layerTypeApplicability";
import type { VisualizationLayerType } from "@/types/mcp.types";

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
  const hiddenLayerIndexes = useMapStore(state => state.hiddenLayerIndexes);
  const toggleLayerVisibility = useMapStore(state => state.toggleLayerVisibility);
  const setHiddenLayerIndexes = useMapStore(state => state.setHiddenLayerIndexes);
  const addSelectedLayer = useChatStore(state => state.addSelectedLayer);
  const selectedLayersForChat = useChatStore(state => state.selectedLayersForChat);
  const activeSessionId = useChatStore(state => state.activeSessionId);
  const queryResultsPanel = useChatStore(state => state.queryResultsPanel);
  const isQueryPanelOpen = useChatStore(state => state.isQueryPanelOpen);
  const toggleQueryPanel = useChatStore(state => state.toggleQueryPanel);
  
  const [showBaseMapMenu, setShowBaseMapMenu] = useState(false);
  const [showLayersMenu, setShowLayersMenu] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  
  const [activeLayerDetails, setActiveLayerDetails] = useState<number | null>(null);
  const [featureSearchQuery, setFeatureSearchQuery] = useState("");
  const [visibleFeatureCount, setVisibleFeatureCount] = useState(60);

  // Memoize active layer data so normalizeGeoJson only runs when active layer changes
  const activeLayerInfo = useMemo(() => {
    if (activeLayerDetails === null || !mapFeatures[activeLayerDetails]) return null;
    const normalized = normalizeGeoJson(mapFeatures[activeLayerDetails]);
    const rawFeatures = normalized?.features || [];
    const firstProps = rawFeatures[0]?.properties || {};
    const title =
      firstProps.name ||
      firstProps.title ||
      firstProps.ntaname ||
      firstProps.boro_name ||
      firstProps.label ||
      `Layer ${activeLayerDetails + 1}`;

    const items = rawFeatures.map((f: any, fIdx: number) => {
      const p = f.properties || {};
      const name =
        p.name ||
        p.title ||
        p.ntaname ||
        p.boro_name ||
        p.zip ||
        p.id ||
        p.instruction ||
        `Feature ${fIdx + 1}`;
      return {
        feature: f,
        fIdx,
        name: String(name),
        props: p,
      };
    });

    return {
      title,
      items,
      totalCount: items.length,
    };
  }, [activeLayerDetails, mapFeatures]);

  // Reset search and visible slice when layer details opened/changed
  useEffect(() => {
    setFeatureSearchQuery("");
    setVisibleFeatureCount(60);
  }, [activeLayerDetails]);

  // Filter features based on search query
  const filteredFeatures = useMemo(() => {
    if (!activeLayerInfo) return [];
    const q = featureSearchQuery.trim().toLowerCase();
    if (!q) return activeLayerInfo.items;
    return activeLayerInfo.items.filter((item: any) =>
      item.name.toLowerCase().includes(q)
    );
  }, [activeLayerInfo, featureSearchQuery]);

  // Slice visible features for smooth 60 FPS progressive loading
  const visibleFeatures = useMemo(() => {
    return filteredFeatures.slice(0, visibleFeatureCount);
  }, [filteredFeatures, visibleFeatureCount]);
  
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const suppressNextLayerClickRef = useRef(false);
  const layoutSignatureRef = useRef(`${layout}:${isCollapsed}:${isMobileOpen}`);

  // Layer type switcher state
  const [layerTypeSwitcherIdx, setLayerTypeSwitcherIdx] = useState<number | null>(null);
  const mapFeatureLayerTypes = useMapStore(state => state.mapFeatureLayerTypes);
  const setMapFeatureLayerType = useMapStore(state => state.setMapFeatureLayerType);
  const mapFeatureLayerStyles = useMapStore(state => state.mapFeatureLayerStyles);
  const activeStylePanelLayerIndex = useMapStore(state => state.activeStylePanelLayerIndex);
  const setActiveStylePanelLayerIndex = useMapStore(state => state.setActiveStylePanelLayerIndex);

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

  const handleFeatureClick = useCallback((f: any) => {
    try {
      fitToGeoJson(f);
    } catch (e) {
      console.error("Failed to zoom to feature", e);
    }
  }, []);

  const handleFeatureDoubleClick = useCallback((f: any, fProps: any, fIdx: number) => {
    try {
      const center = turf.center(f);
      const [lng, lat] = center.geometry.coordinates;

      const viewport = new WebMercatorViewport({
        width: typeof window !== "undefined" ? window.innerWidth : 800,
        height: typeof window !== "undefined" ? window.innerHeight : 600,
        longitude: viewState.longitude,
        latitude: viewState.latitude,
        zoom: viewState.zoom,
        pitch: viewState.pitch,
        bearing: viewState.bearing,
      });

      const [x, y] = viewport.project([lng, lat]);

      useMapStore.getState().setLockedHoverInfo({
        props: { ...fProps, _layerIndex: activeLayerDetails, _featureIndex: fIdx },
        x,
        y,
        lng,
        lat,
      });
    } catch (err) {
      console.error("Failed to project feature center", err);
      useMapStore.getState().setLockedHoverInfo({
        props: { ...fProps, _layerIndex: activeLayerDetails, _featureIndex: fIdx },
        x: typeof window !== "undefined" ? window.innerWidth / 2 : 400,
        y: typeof window !== "undefined" ? window.innerHeight / 2 : 300,
      });
    }
  }, [activeLayerDetails, viewState]);

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

      // Remap hiddenLayerIndexes so visibility persists on reordering
      setHiddenLayerIndexes((prev) =>
        prev.map((i) => {
          if (i === draggedIdx) return dragOverIdx;
          if (draggedIdx < dragOverIdx && i > draggedIdx && i <= dragOverIdx) return i - 1;
          if (draggedIdx > dragOverIdx && i >= dragOverIdx && i < draggedIdx) return i + 1;
          return i;
        })
      );
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
        {activeLayerDetails !== null && activeLayerInfo && (
          <div className="absolute top-16 left-4 bottom-24 w-72 md:w-80 bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl z-30 flex flex-col overflow-hidden pointer-events-auto animate-in slide-in-from-left-4 fade-in duration-200">
            {/* Header with Title & Feature Count */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
              <div className="flex items-center gap-1.5 truncate flex-1 pr-2">
                <span className="text-sm font-semibold truncate text-foreground">
                  {activeLayerInfo.title}
                </span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                  {activeLayerInfo.totalCount}
                </span>
              </div>
              <button 
                onClick={() => setActiveLayerDetails(null)}
                className="p-1 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Search Bar (if layer has > 10 features) */}
            {activeLayerInfo.totalCount > 10 && (
              <div className="px-2.5 py-1.5 border-b border-border/60 bg-muted/15">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 absolute left-2 text-muted-foreground/70 pointer-events-none" />
                  <input
                    type="text"
                    placeholder={`Search ${activeLayerInfo.totalCount} features...`}
                    value={featureSearchQuery}
                    onChange={(e) => {
                      setFeatureSearchQuery(e.target.value);
                      setVisibleFeatureCount(60);
                    }}
                    className="w-full bg-background/70 text-xs pl-7 pr-7 py-1 rounded-md border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary/60 placeholder:text-muted-foreground/60 text-foreground"
                  />
                  {featureSearchQuery && (
                    <button
                      onClick={() => {
                        setFeatureSearchQuery("");
                        setVisibleFeatureCount(60);
                      }}
                      className="absolute right-2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
                      title="Clear search"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Virtualized / Progressive Feature List */}
            <div 
              className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 py-1"
              onScroll={(e) => {
                const target = e.currentTarget;
                if (target.scrollHeight - target.scrollTop <= target.clientHeight + 200) {
                  if (visibleFeatureCount < filteredFeatures.length) {
                    setVisibleFeatureCount((prev) => Math.min(prev + 60, filteredFeatures.length));
                  }
                }
              }}
            >
              {visibleFeatures.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No matching features found
                </div>
              ) : (
                visibleFeatures.map((item: any) => (
                  <div 
                    key={item.fIdx}
                    className="flex flex-col justify-center px-3 py-1.5 text-[12px] border-b border-border/30 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => handleFeatureClick(item.feature)}
                    onDoubleClick={() => handleFeatureDoubleClick(item.feature, item.props, item.fIdx)}
                    title="Click to zoom, Double click for details"
                  >
                    <span className="font-medium truncate text-foreground/85">{item.name}</span>
                  </div>
                ))
              )}

              {/* Infinite Scroll Indicator */}
              {visibleFeatureCount < filteredFeatures.length && (
                <div className="p-2 text-center text-[11px] text-muted-foreground/70 border-t border-border/20">
                  Showing {visibleFeatureCount} of {filteredFeatures.length} features (scroll for more)
                </div>
              )}
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
              <div className="absolute top-full right-0 mt-2 w-80 sm:w-[350px] max-w-[calc(100vw-2rem)] bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden flex flex-col py-1 animate-in fade-in zoom-in-95 duration-100 z-50">
                <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex justify-between items-center border-b border-border/40 mb-1">
                  <div className="flex items-center gap-1.5">
                    <span>Map Layers</span>
                    {mapFeatures.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground">
                        {mapFeatures.length}
                      </span>
                    )}
                  </div>
                  {mapFeatures.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          if (hiddenLayerIndexes.length === mapFeatures.length) {
                            setHiddenLayerIndexes([]);
                          } else {
                            setHiddenLayerIndexes(mapFeatures.map((_, i) => i));
                          }
                        }}
                        className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                        title={hiddenLayerIndexes.length === mapFeatures.length ? "Show all layers" : "Hide all layers"}
                      >
                        {hiddenLayerIndexes.length === mapFeatures.length ? "Show All" : "Hide All"}
                      </button>
                      <span className="text-border">|</span>
                      <button 
                        onClick={() => {
                          if (activeSessionId?.startsWith("shared-")) {
                            import("sonner").then(({ toast }) => toast.error("You are not allowed to do that. Shared sessions are read-only."));
                            return;
                          }
                          setMapFeatures([]);
                          setSelectedLayerIndex(null);
                          setHiddenLayerIndexes([]);
                          // Delete all layers from Supabase
                          if (activeSessionId) {
                            deleteAllLayers(activeSessionId).catch((e) =>
                              console.error("[MapWorkspace] Failed to delete all layers from Supabase:", e)
                            );
                          }
                        }}
                        className="text-red-500 hover:text-red-600 text-[11px] capitalize font-medium flex items-center gap-1 transition-colors"
                      >
                        Clear All
                      </button>
                    </div>
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
                      const isVisible = !hiddenLayerIndexes.includes(idx);
                      
                      return (
                        <div 
                          key={idx} 
                          draggable
                          onDragStart={() => handleDragStart(idx)}
                          onDragEnter={() => handleDragEnter(idx)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => e.preventDefault()}
                          className={`flex flex-col mb-1.5 mx-2 text-sm text-foreground bg-card border rounded-md shadow-sm transition-all group cursor-pointer
                            ${dragOverIdx === idx ? "border-primary border-t-2 bg-muted/50 scale-[1.02]" : 
                              isSelectedForChat
                                ? "border-green-500 bg-green-500/10 ring-1 ring-green-500/50"
                                : isSelectedLayer
                                  ? "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/50"
                                : "border-border hover:border-primary/40 hover:shadow-md"}
                            ${draggedIdx === idx ? "opacity-50 scale-95" : "opacity-100"}
                            ${!isVisible ? "opacity-60 bg-muted/20" : ""}
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
                          {/* Layer Row: Grip + Eye Icon + Name + Badges + Buttons */}
                          <div className="flex items-center px-2 py-2">
                            <div 
                              className="mr-1 text-muted-foreground/40 group-hover:text-muted-foreground cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-muted/60"
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              title="Drag to reorder"
                            >
                              <GripVertical className="w-4 h-4" />
                            </div>

                            {/* Visibility Toggle Button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleLayerVisibility(idx);
                              }}
                              onDoubleClick={(e) => e.stopPropagation()}
                              className={`p-1 mr-1.5 rounded transition-all shrink-0 ${
                                isVisible
                                  ? "text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400 dark:hover:bg-emerald-400/15"
                                  : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted"
                              }`}
                              title={isVisible ? "Hide layer from map" : "Show layer on map"}
                            >
                              {isVisible ? (
                                <Eye className="w-4 h-4" />
                              ) : (
                                <EyeOff className="w-4 h-4" />
                              )}
                            </button>

                            {/* Layer Name with Active Color */}
                            <span 
                              className={`truncate flex-1 pr-2 text-[13px] transition-colors pointer-events-none ${
                                isVisible
                                  ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                                  : "text-muted-foreground/50 line-through decoration-muted-foreground/40 font-normal"
                              }`}
                              title={layerName}
                            >
                              {layerName}
                            </span>

                            {/* Active Visualization Layer Badge */}
                            {mapFeatureLayerTypes[idx] && mapFeatureLayerTypes[idx] !== "GeoJsonLayer" && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary mr-1 flex items-center gap-1 shrink-0">
                                <Sparkles className="w-2.5 h-2.5" />
                                {ALL_LAYER_TYPES.find((t) => t.type === mapFeatureLayerTypes[idx])?.shortLabel || mapFeatureLayerTypes[idx].replace("Layer", "")}
                              </span>
                            )}

                            {/* Layer Settings Config Button (if active viz type) */}
                            {mapFeatureLayerTypes[idx] && mapFeatureLayerTypes[idx] !== "GeoJsonLayer" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedLayerIndex(selectedLayerIndex === idx ? null : idx);
                                }}
                                className={`text-muted-foreground hover:text-primary transition-opacity p-1 rounded hover:bg-primary/10 mr-0.5 shrink-0 ${
                                  selectedLayerIndex === idx ? '!opacity-100 text-primary bg-primary/10' : 'opacity-60 group-hover:opacity-100'
                                }`}
                                title="Configure Layer Settings"
                              >
                                <SlidersHorizontal className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Layer Style Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveStylePanelLayerIndex(
                                  activeStylePanelLayerIndex === idx ? null : idx
                                );
                              }}
                              className={`transition-all p-1 rounded mr-0.5 shrink-0 ${
                                activeStylePanelLayerIndex === idx
                                  ? '!opacity-100 text-violet-500 bg-violet-500/15'
                                  : mapFeatureLayerStyles[idx]
                                  ? 'text-violet-400 opacity-90 hover:text-violet-500 hover:bg-violet-500/10'
                                  : 'text-muted-foreground opacity-60 group-hover:opacity-100 hover:text-foreground hover:bg-muted'
                              }`}
                              title={mapFeatureLayerStyles[idx] ? "Edit Layer Style" : "Style Layer"}
                            >
                              <Paintbrush className="w-3.5 h-3.5" />
                            </button>

                            {/* Change Layer Type Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setLayerTypeSwitcherIdx(layerTypeSwitcherIdx === idx ? null : idx);
                              }}
                              className={`text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-primary/10 shrink-0 ${
                                layerTypeSwitcherIdx === idx ? '!opacity-100 text-primary bg-primary/10' : ''
                              }`}
                              title="Change Layer Type"
                            >
                              <Shapes className="w-3.5 h-3.5" />
                            </button>

                            {/* Remove Layer Button */}
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
                                setHiddenLayerIndexes((prev) =>
                                  prev.filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i))
                                );
                                if (selectedLayerIndex === idx) {
                                  setSelectedLayerIndex(null);
                                } else if (selectedLayerIndex !== null && selectedLayerIndex > idx) {
                                  setSelectedLayerIndex(selectedLayerIndex - 1);
                                }
                                if (activeSessionId) {
                                  deleteLayerFromSupabase(activeSessionId, idx).catch((e) =>
                                    console.error("[MapWorkspace] Failed to delete layer from Supabase:", e)
                                  );
                                }
                              }}
                              className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10 shrink-0"
                              title="Remove Layer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Layer Type Switcher Popover */}
                          {layerTypeSwitcherIdx === idx && (() => {
                            const applicable = getApplicableLayerTypes(normalizeGeoJson(featureObj));
                            const currentType = mapFeatureLayerTypes[idx] || "GeoJsonLayer";
                            return (
                              <div
                                className="mx-2 mb-2 p-2 rounded-lg bg-muted/50 border border-border/50"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="grid grid-cols-3 gap-1">
                                  {ALL_LAYER_TYPES.map((lt) => {
                                    const isApplicable = applicable.has(lt.type);
                                    const isActive = currentType === lt.type;
                                    return (
                                      <button
                                        key={lt.type}
                                        disabled={!isApplicable}
                                        onClick={() => {
                                          if (!isApplicable) return;
                                          setMapFeatureLayerType(idx, lt.type);
                                          setSelectedLayerIndex(idx);
                                          setLayerTypeSwitcherIdx(null);
                                        }}
                                        className={`px-1.5 py-1.5 rounded text-[10px] font-medium leading-tight text-center transition-all
                                          ${isActive
                                            ? 'bg-primary text-primary-foreground ring-1 ring-primary shadow-sm'
                                            : isApplicable
                                              ? 'bg-card text-foreground hover:bg-muted hover:ring-1 hover:ring-primary/40 cursor-pointer'
                                              : 'bg-muted/20 text-muted-foreground/40 cursor-not-allowed opacity-50'
                                          }
                                        `}
                                        title={isApplicable ? lt.description : `Not applicable: ${lt.description}`}
                                      >
                                        {lt.shortLabel}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Query Results Panel Toggle */}
          <button
            onClick={toggleQueryPanel}
            className={`relative p-2 backdrop-blur-md rounded-md shadow-sm border text-foreground transition-colors flex items-center gap-2 ${
              isQueryPanelOpen
                ? 'bg-primary/10 border-primary/40 hover:bg-primary/20'
                : 'bg-background/80 border-border hover:bg-muted'
            }`}
            title="Toggle Query Results Panel"
          >
            <Table2 className="w-5 h-5" />
            {queryResultsPanel.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                {queryResultsPanel.length}
              </span>
            )}
          </button>
        </div>

      {/* Floating Layer Configuration Panel (Bottom Right of Map) */}
      {selectedLayerIndex !== null &&
        mapFeatures[selectedLayerIndex] &&
        mapFeatureLayerTypes[selectedLayerIndex] &&
        mapFeatureLayerTypes[selectedLayerIndex] !== "GeoJsonLayer" && (
          <div className="absolute bottom-6 right-4 z-30 pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-200">
            <LayerConfigPanel
              layerIndex={selectedLayerIndex}
              layerType={mapFeatureLayerTypes[selectedLayerIndex]}
              layerName={(() => {
                const normalized = normalizeGeoJson(mapFeatures[selectedLayerIndex]);
                const first = normalized?.features?.[0]?.properties;
                return first?.name || first?.title || first?.instruction || `Layer ${selectedLayerIndex + 1}`;
              })()}
              onClose={() => setSelectedLayerIndex(null)}
              onSwitchLayerType={(newType) => setMapFeatureLayerType(selectedLayerIndex, newType)}
              applicableLayerTypes={Array.from(getApplicableLayerTypes(normalizeGeoJson(mapFeatures[selectedLayerIndex])))}
            />
          </div>
        )}

      {/* Floating Layer Style Panel (Bottom Right of Map) */}
      {activeStylePanelLayerIndex !== null &&
        mapFeatures[activeStylePanelLayerIndex] && (
          <div className="absolute bottom-6 right-4 z-30 pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-200">
            <LayerStylePanel
              layerIndex={activeStylePanelLayerIndex}
              layerName={(() => {
                const normalized = normalizeGeoJson(mapFeatures[activeStylePanelLayerIndex]);
                const first = normalized?.features?.[0]?.properties;
                return first?.name || first?.title || first?.instruction || `Layer ${activeStylePanelLayerIndex + 1}`;
              })()}
              onClose={() => setActiveStylePanelLayerIndex(null)}
            />
          </div>
        )}

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
      {/* DuckDB Query Results Panel (right side, client-only) */}
      <QueryResultsPanel />

    </main>
  );
};
