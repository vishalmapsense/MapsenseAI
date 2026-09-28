"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowUp, Database, Loader2, Bot, Layers, Check, ChevronDown, GripVertical } from "lucide-react";
import { useChatStore } from "@/stores/useChatStore";
import { useMapStore } from "@/stores/useMapStore";
import { sanitizeTableName, extractLayerTitle } from "@/stores/useDataReferenceStore";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { toast } from "sonner";
import type { ChatMessage } from "@/types/mcp.types";
import { cleanMessageContent, isInternalOrEmptyMessage } from "@/utils/messageCleaner";
import { renderAgentEvents } from "@/components/chat/ChatMessageList";

const getLayerInfo = (featureObj: any, idx: number) => {
  if (!featureObj) return { name: `layer_${idx + 1}`, count: 0, props: {} };
  const features = Array.isArray(featureObj?.features)
    ? featureObj.features
    : featureObj?.type === "Feature"
    ? [featureObj]
    : [];
  const firstFeat = features[0];
  const props = firstFeat?.properties || {};
  const name = extractLayerTitle(featureObj, idx);
  return {
    name,
    count: features.length,
    props,
  };
};

type ResizeDirection =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const MapSQLChat = () => {
  const { mapSqlChat, closeMapSqlChat, sendMapSqlMessage } = useChatStore();
  const mapFeatures = useMapStore((state) => state.mapFeatures);
  const selectedLayerIndex = useMapStore((state) => state.selectedLayerIndex);

  const [inputValue, setInputValue] = useState("");
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedLayerIndexes, setSelectedLayerIndexes] = useState<number[]>([]);
  const [showLayerMenu, setShowLayerMenu] = useState(false);

  // Dimensions (compact initially, expands when messages appear)
  const DEFAULT_WIDTH = 380;
  const DEFAULT_HEIGHT = 280;
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });

  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const layerMenuRef = useRef<HTMLDivElement>(null);

  const visibleSqlMessages = mapSqlChat.messages.filter(
    (msg) => msg.isLoading || !isInternalOrEmptyMessage(msg.role, msg.content)
  );
  const hasMessages = visibleSqlMessages.length > 0;
  const prevHasMessagesRef = useRef(false);

  // Helper to get current map container boundaries
  const getContainerBounds = useCallback(() => {
    const parent = windowRef.current?.parentElement;
    if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) {
      return {
        width: parent.clientWidth,
        height: parent.clientHeight,
      };
    }
    return {
      width: typeof window !== "undefined" ? window.innerWidth : 1024,
      height: typeof window !== "undefined" ? window.innerHeight : 768,
    };
  }, []);

  // Auto-select map layer if available when SQL chat opens
  useEffect(() => {
    if (mapSqlChat.isOpen && selectedLayerIndexes.length === 0 && mapFeatures.length > 0) {
      const defaultIdx =
        selectedLayerIndex !== null && selectedLayerIndex >= 0 && selectedLayerIndex < mapFeatures.length
          ? selectedLayerIndex
          : 0;
      setSelectedLayerIndexes([defaultIdx]);
    }
  }, [mapSqlChat.isOpen, mapFeatures, selectedLayerIndex, selectedLayerIndexes.length]);

  // Set initial position when opened (strictly clamped inside map container)
  useEffect(() => {
    if (mapSqlChat.isOpen && mapSqlChat.clickCoords && !position) {
      const bounds = getContainerBounds();
      const PADDING = 12;
      let x = mapSqlChat.clickCoords.x - 20;
      let y = mapSqlChat.clickCoords.y - 20;

      const maxX = Math.max(PADDING, bounds.width - size.width - PADDING);
      const maxY = Math.max(PADDING, bounds.height - 60 - PADDING);

      x = Math.max(PADDING, Math.min(x, maxX));
      y = Math.max(PADDING, Math.min(y, maxY));
      setPosition({ x, y });
    }
    if (!mapSqlChat.isOpen) {
      setPosition(null);
      setSelectedLayerIndexes([]);
      setShowLayerMenu(false);
      setSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
    }
  }, [mapSqlChat.isOpen, mapSqlChat.clickCoords, getContainerBounds]);

  // When first message is sent, expand window upwards so input stays anchored
  useEffect(() => {
    if (!prevHasMessagesRef.current && hasMessages && position) {
      const bounds = getContainerBounds();
      const PADDING = 8;
      const heightDiff = size.height - 52;
      const targetY = Math.max(PADDING, position.y - heightDiff);
      setPosition((prev) => (prev ? { ...prev, y: targetY } : prev));
    }
    prevHasMessagesRef.current = hasMessages;
  }, [hasMessages, size.height, getContainerBounds]);

  // Keep window strictly inside map container if map container or window resizes
  useEffect(() => {
    if (!position || !mapSqlChat.isOpen) return;
    const handleResize = () => {
      const bounds = getContainerBounds();
      const PADDING = 8;
      const currentHeight = hasMessages ? size.height : 52;
      const maxX = Math.max(PADDING, bounds.width - size.width - PADDING);
      const maxY = Math.max(PADDING, bounds.height - currentHeight - PADDING);

      setPosition((prev) => {
        if (!prev) return prev;
        const clampedX = Math.max(PADDING, Math.min(prev.x, maxX));
        const clampedY = Math.max(PADDING, Math.min(prev.y, maxY));
        if (clampedX !== prev.x || clampedY !== prev.y) {
          return { x: clampedX, y: clampedY };
        }
        return prev;
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [position, size, mapSqlChat.isOpen, hasMessages, getContainerBounds]);

  // Close layer menu on outside click
  useEffect(() => {
    if (!showLayerMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (layerMenuRef.current && !layerMenuRef.current.contains(e.target as Node)) {
        setShowLayerMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showLayerMenu]);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mapSqlChat.messages]);

  // Pre-sync map layers into client DuckDB whenever SQL chat is opened or mapFeatures change
  useEffect(() => {
    if (mapSqlChat.isOpen && mapFeatures.length > 0) {
      import("@/services/duckdb/clientDuckDB").then(({ clientDuckDB }) => {
        clientDuckDB.syncMapLayers(mapFeatures).catch((err) =>
          console.warn("[MapSQLChat] Could not pre-sync map layers:", err)
        );
      });
    }
  }, [mapSqlChat.isOpen, mapFeatures]);

  // Focus input when opened
  useEffect(() => {
    if (mapSqlChat.isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [mapSqlChat.isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!mapSqlChat.isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showLayerMenu) {
          setShowLayerMenu(false);
        } else {
          closeMapSqlChat();
        }
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [mapSqlChat.isOpen, closeMapSqlChat, showLayerMenu]);

  // Drag handlers (strictly restricted within map container)
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!position) return;
      e.preventDefault();
      setIsDragging(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        posX: position.x,
        posY: position.y,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = moveEvent.clientX - dragRef.current.startX;
        const dy = moveEvent.clientY - dragRef.current.startY;

        const bounds = getContainerBounds();
        const PADDING = 8;
        const currentHeight = hasMessages ? size.height : 52;
        const maxX = Math.max(PADDING, bounds.width - size.width - PADDING);
        const maxY = Math.max(PADDING, bounds.height - currentHeight - PADDING);

        const targetX = dragRef.current.posX + dx;
        const targetY = dragRef.current.posY + dy;

        setPosition({
          x: Math.max(PADDING, Math.min(targetX, maxX)),
          y: Math.max(PADDING, Math.min(targetY, maxY)),
        });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        dragRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [position, size, hasMessages, getContainerBounds]
  );

  const toggleLayerSelection = (idx: number) => {
    setSelectedLayerIndexes((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  // Edge and Corner Resizing Handlers (Strictly restricted inside map container)
  const handleResizeStart = useCallback(
    (direction: ResizeDirection, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = size.width;
      const startHeight = size.height;
      const startPosX = position?.x ?? 0;
      const startPosY = position?.y ?? 0;

      const bounds = getContainerBounds();
      const PADDING = 8;
      const MIN_HEIGHT = 180;
      const MIN_WIDTH = 280;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newX = startPosX;
        let newY = startPosY;

        // Vertical adjustment (sliding top or bottom edge)
        if (direction.includes("bottom")) {
          const maxHeight = Math.max(MIN_HEIGHT, bounds.height - startPosY - PADDING);
          newHeight = Math.min(Math.max(MIN_HEIGHT, startHeight + deltaY), maxHeight);
        } else if (direction.includes("top")) {
          const desiredHeight = startHeight - deltaY;
          const maxAllowedHeight = Math.max(MIN_HEIGHT, startPosY + startHeight - PADDING);
          newHeight = Math.min(Math.max(MIN_HEIGHT, desiredHeight), maxAllowedHeight);
          newY = startPosY + (startHeight - newHeight);
        }

        // Horizontal adjustment (sliding left or right edge)
        if (direction.includes("right")) {
          const maxWidth = Math.max(MIN_WIDTH, bounds.width - startPosX - PADDING);
          newWidth = Math.min(Math.max(MIN_WIDTH, startWidth + deltaX), maxWidth);
        } else if (direction.includes("left")) {
          const desiredWidth = startWidth - deltaX;
          const maxAllowedWidth = Math.max(MIN_WIDTH, startPosX + startWidth - PADDING);
          newWidth = Math.min(Math.max(MIN_WIDTH, desiredWidth), maxAllowedWidth);
          newX = startPosX + (startWidth - newWidth);
        }

        setSize({ width: newWidth, height: newHeight });
        if (direction.includes("top") || direction.includes("left")) {
          setPosition({
            x: Math.max(PADDING, newX),
            y: Math.max(PADDING, newY),
          });
        }
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [size, position, getContainerBounds]
  );

  const hasSelectedLayers = selectedLayerIndexes.length > 0;
  const canSubmit = hasSelectedLayers && inputValue.trim().length > 0 && !mapSqlChat.isLoading;

  const handleSend = useCallback(async () => {
    if (!hasSelectedLayers) {
      setShowLayerMenu(true);
      toast.info("Submit karne ke liye pehle map layer select karein");
      return;
    }
    const trimmed = inputValue.trim();
    if (!trimmed || mapSqlChat.isLoading) return;
    setInputValue("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setShowLayerMenu(false);

    // Ensure map layers are pre-synced in client-side DuckDB-Wasm before query execution
    try {
      const { clientDuckDB } = await import("@/services/duckdb/clientDuckDB");
      await clientDuckDB.syncMapLayers(mapFeatures);
    } catch (e) {
      console.warn("[MapSQLChat] Layer sync prior to send warning:", e);
    }

    let layerContext = "";
    if (selectedLayerIndexes.length > 0) {
      const summaries = selectedLayerIndexes
        .map((idx) => {
          const featObj = mapFeatures[idx];
          if (!featObj) return null;
          const info = getLayerInfo(featObj, idx);
          const tableName = sanitizeTableName(info.name);
          const sampleCols = Object.keys(info.props).filter((k) => !k.startsWith("_")).slice(0, 10);
          return `- Layer: "${info.name}" | DuckDB Table: "${tableName}" (alias: "layer_${idx + 1}") | Features: ${info.count}${sampleCols.length > 0 ? ` | Columns: ${sampleCols.join(", ")}` : ""}`;
        })
        .filter(Boolean);

      if (summaries.length > 0) {
        const primaryIdx = selectedLayerIndexes[0];
        const primaryInfo = getLayerInfo(mapFeatures[primaryIdx], primaryIdx);
        const primaryTable = sanitizeTableName(primaryInfo.name);
        const firstAttrCol = Object.keys(primaryInfo.props).find((k) => !k.startsWith("_") && typeof primaryInfo.props[k] === "string") || Object.keys(primaryInfo.props)[0] || "id";

        const tableList = selectedLayerIndexes
          .map((idx) => sanitizeTableName(getLayerInfo(mapFeatures[idx], idx).name))
          .join('", "');

        layerContext = `[SELECTED_MAP_LAYERS]\n` +
          `User selected the following map layer(s) as the target for this query:\n` +
          `${summaries.join("\n")}\n\n` +
          `CRITICAL INSTRUCTIONS FOR THIS QUERY:\n` +
          `1. Table "${tableList}" (and alias "layer_1", plus "map_features") is ALREADY LOADED in client-side DuckDB-Wasm in the browser.\n` +
          `2. COLORING / STYLING RULE: If the user asks to COLOR, STYLE, HIGHLIGHT, CATEGORIZE, or FILTER-AND-COLOR the layer (e.g. 'south and north ke basis par color karo', 'color by status', 'filter karke color karo'):\n` +
          `   - ✅ For direct properties: Call 'map_style_layer' with layerIndex=${primaryIdx} and style={ type: 'category', field: '<col>' }.\n` +
          `   - ✅ For grouping concepts (e.g. 'South' vs 'North'): Use 'valueGroups' in 'map_style_layer' (e.g. valueGroups: { 'South': ['Tamil Nadu', 'Kerala', 'Karnataka', ...], 'North': ['Delhi', 'Uttar Pradesh', 'Punjab', ...] }).\n` +
          `   - ✅ For condition-based styling: Use 'rules' in 'map_style_layer' or 'ranges' for numeric classes.\n` +
          `   - ✅ If the user specifically asks to filter via SQL first, call 'run_client_duckdb_query' with applyToMap: true, then style with 'map_style_layer'.\n` +
          `3. For analytical / SQL questions: You MUST use 'run_client_duckdb_query' to execute SQL. DO NOT call backend run_duck_db_queries.\n` +
          `4. NEVER claim the table does not exist. The table is right here in DuckDB-Wasm.\n` +
          `5. The spatial geometry is stored as a GeoJSON string in the 'geometry' column.\n` +
          `   - To use spatial functions (e.g. ST_Intersection), you MUST use: ST_GeomFromGeoJSON(geometry)\n` +
          `   - We also provide PRE-COMPUTED columns:\n` +
          `     * center_lat, center_lng, lat, lng, centroid (WKT 'POINT(lng lat)')\n` +
          `     * area_sq_km, area_sq_meters, perimeter_km\n` +
          `   - In 'map_features', layer filter column is: __layer_name = '${primaryTable}'\n` +
          `6. EXAMPLE QUERIES:\n` +
          `   - Centroid of all features: SELECT "${firstAttrCol}", center_lat, center_lng, centroid FROM "${primaryTable}";\n` +
          `   - Intersection area: SELECT ST_Area(ST_Intersection(ST_GeomFromGeoJSON(a.geometry), ST_GeomFromGeoJSON(b.geometry))) FROM "layer_1" AS a, "layer_2" AS b;\n` +
          `   (❌ Avoid ST_Centroid() if possible — use pre-computed columns center_lat, center_lng directly!)\n` +
          `7. Query results will appear directly in the Query Results Panel. Provide a concise 1-2 sentence answer.\n` +
          `[/SELECTED_MAP_LAYERS]`;
      }
    }

    await sendMapSqlMessage(trimmed, layerContext);
  }, [hasSelectedLayers, inputValue, mapSqlChat.isLoading, selectedLayerIndexes, mapFeatures, sendMapSqlMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!hasSelectedLayers) {
        setShowLayerMenu(true);
        toast.info("Submit karne ke liye pehle map layer select karein");
        return;
      }
      if (canSubmit) {
        handleSend();
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 80)}px`;
    }
  };

  if (!mapSqlChat.isOpen || !position) return null;

  return (
    <AnimatePresence>
      {mapSqlChat.isOpen && (
        <motion.div
          ref={windowRef}
          initial={{ opacity: 0, scale: 0.94, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 6 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="absolute z-40 pointer-events-auto"
          style={{
            left: position.x,
            top: position.y,
            width: size.width,
            height: hasMessages ? size.height : "auto",
          }}
        >
          {/* ─── Floating Layer Menu (Never clipped by card overflow) ─── */}
          <AnimatePresence>
            {showLayerMenu && (
              <motion.div
                ref={layerMenuRef}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-0 right-0 mb-2 bg-background/95 dark:bg-background/90 backdrop-blur-2xl border border-border/70 rounded-2xl shadow-2xl p-2.5 z-50 overflow-hidden"
              >
                <div className="flex items-center justify-between pb-2 mb-1.5 border-b border-border/30 text-[11px]">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-cyan-500" />
                    Select Map Layer ({mapFeatures.length})
                  </span>
                  {mapFeatures.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedLayerIndexes.length === mapFeatures.length) {
                            setSelectedLayerIndexes([]);
                          } else {
                            setSelectedLayerIndexes(mapFeatures.map((_, i) => i));
                          }
                        }}
                        className="text-cyan-500 hover:text-cyan-400 text-[10px] font-medium transition-colors cursor-pointer"
                      >
                        {selectedLayerIndexes.length === mapFeatures.length ? "Deselect All" : "Select All"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowLayerMenu(false)}
                        className="text-muted-foreground hover:text-foreground text-[10px] p-0.5 rounded transition-colors cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {mapFeatures.length === 0 ? (
                  <div className="py-4 text-center text-[11px] text-muted-foreground">
                    No layers on the map yet. Add a layer to query it.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto flex flex-col gap-1 scrollbar-thin scrollbar-thumb-muted-foreground/20">
                    {mapFeatures.map((featObj, idx) => {
                      const info = getLayerInfo(featObj, idx);
                      const isChecked = selectedLayerIndexes.includes(idx);
                      return (
                        <div
                          key={idx}
                          onClick={() => toggleLayerSelection(idx)}
                          className={`flex items-center justify-between p-1.5 rounded-lg cursor-pointer text-[11.5px] transition-all duration-100 ${
                            isChecked
                              ? "bg-cyan-500/20 text-foreground font-medium border border-cyan-500/35"
                              : "hover:bg-muted/40 text-muted-foreground hover:text-foreground border border-transparent"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate pr-2">
                            <div
                              className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                                isChecked
                              ? "bg-cyan-500 border-cyan-500 text-white"
                              : "border-border/80 bg-background/50"
                            }`}
                            >
                              {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                            </div>
                            <div className="flex flex-col truncate">
                              <span className="truncate leading-tight text-foreground">{info.name}</span>
                              <span className="text-[9px] text-muted-foreground/70 font-mono">
                                Table: "{sanitizeTableName(info.name)}"
                              </span>
                            </div>
                          </div>
                          <span className="shrink-0 text-[9.5px] bg-muted/60 px-1.5 py-0.5 rounded font-mono text-muted-foreground">
                            {info.count} feat
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Totally Transparent Container (Zero window background) */}
          <div
            className={`relative flex flex-col h-full bg-transparent border-none shadow-none ${
              isDragging ? "ring-1 ring-cyan-500/30 rounded-2xl" : ""
            } ${isResizing ? "select-none ring-1 ring-cyan-500/30 rounded-2xl" : ""}`}
          >
            {/* ─── Edge Resize Handles (Active when messages are expanded) ─── */}
            {hasMessages && (
              <>
                {/* Top edge */}
                <div
                  onMouseDown={(e) => handleResizeStart("top", e)}
                  className="absolute top-0 left-3 right-3 h-2 cursor-ns-resize z-30 group flex items-start justify-center"
                  title="Drag up or down to adjust height"
                >
                  <div className="w-8 h-1 rounded-full bg-foreground/25 group-hover:bg-cyan-500 transition-colors mt-0.5" />
                </div>

                {/* Bottom edge */}
                <div
                  onMouseDown={(e) => handleResizeStart("bottom", e)}
                  className="absolute bottom-0 left-3 right-5 h-2.5 cursor-ns-resize z-30 group flex items-end justify-center"
                  title="Drag up or down to adjust height"
                >
                  <div className="w-10 h-1 rounded-full bg-foreground/25 group-hover:bg-cyan-500 transition-colors mb-0.5" />
                </div>

                {/* Left edge */}
                <div
                  onMouseDown={(e) => handleResizeStart("left", e)}
                  className="absolute top-3 bottom-3 left-0 w-2 cursor-ew-resize z-30 hover:bg-cyan-500/20 transition-colors"
                  title="Drag left or right to adjust width"
                />

                {/* Right edge */}
                <div
                  onMouseDown={(e) => handleResizeStart("right", e)}
                  className="absolute top-3 bottom-3 right-0 w-2 cursor-ew-resize z-30 hover:bg-cyan-500/20 transition-colors"
                  title="Drag left or right to adjust width"
                />

                {/* Corners */}
                <div
                  onMouseDown={(e) => handleResizeStart("top-left", e)}
                  className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize z-40 hover:bg-cyan-500/30 rounded-tl-xl transition-colors"
                  title="Drag to resize"
                />
                <div
                  onMouseDown={(e) => handleResizeStart("top-right", e)}
                  className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize z-40 hover:bg-cyan-500/30 rounded-tr-xl transition-colors"
                  title="Drag to resize"
                />
                <div
                  onMouseDown={(e) => handleResizeStart("bottom-left", e)}
                  className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize z-40 hover:bg-cyan-500/30 rounded-bl-xl transition-colors"
                  title="Drag to resize"
                />
                <div
                  onMouseDown={(e) => handleResizeStart("bottom-right", e)}
                  className="absolute bottom-0.5 right-0.5 w-4 h-4 cursor-nwse-resize z-40 flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity"
                  title="Drag to resize height and width"
                >
                  <svg className="w-2.5 h-2.5 text-foreground/70" viewBox="0 0 6 6" fill="none">
                    <circle cx="5" cy="5" r="0.7" fill="currentColor" />
                    <circle cx="5" cy="2" r="0.7" fill="currentColor" />
                    <circle cx="2" cy="5" r="0.7" fill="currentColor" />
                  </svg>
                </div>
              </>
            )}

            {/* ─── Messages Area (Shows ABOVE the input when user sends a message) ─── */}
            {hasMessages && (
              <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1.5 flex flex-col gap-2.5 scrollbar-thin scrollbar-thumb-muted-foreground/20">
                {visibleSqlMessages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* ─── Input Bar (Docked at the bottom, solid card background for readability) ─── */}
            <div className="shrink-0 bg-background/95 dark:bg-card/95 backdrop-blur-xl border border-border/70 dark:border-border/60 shadow-xl shadow-black/20 rounded-2xl px-2 py-1.5 relative">
              {/* Input Row */}
              <div className="flex items-center gap-1.5">
                {/* Drag Handle */}
                <div
                  onMouseDown={handleDragStart}
                  className="shrink-0 flex items-center justify-center px-0.5 text-muted-foreground/40 hover:text-muted-foreground/80 cursor-grab active:cursor-grabbing select-none"
                  title="Drag to move"
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </div>

                {/* Layer Select Button (ONLY icon with bottom arrow + Tooltip) */}
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    onClick={() => setShowLayerMenu((prev) => !prev)}
                    className={`relative shrink-0 h-[34px] px-2 rounded-xl flex items-center gap-1 border transition-all duration-150 cursor-pointer ${
                      hasSelectedLayers
                        ? "bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border-cyan-500/40 shadow-xs"
                        : "bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 border-amber-500/40 ring-2 ring-amber-500/20"
                    }`}
                    aria-label="Select Map Layer"
                    title={
                      hasSelectedLayers
                        ? `Selected: ${selectedLayerIndexes.map((i) => getLayerInfo(mapFeatures[i], i).name).join(", ")}`
                        : "Click to select a map layer"
                    }
                  >
                    <Layers className={`w-3.5 h-3.5 ${hasSelectedLayers ? 'text-cyan-500' : 'text-amber-500'}`} />
                    <ChevronDown
                      className={`w-2.5 h-2.5 opacity-70 transition-transform duration-150 ${
                        showLayerMenu ? "rotate-180" : ""
                      }`}
                    />
                    {hasSelectedLayers ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shrink-0" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping shrink-0" />
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[11px] max-w-[220px] truncate z-50">
                    {hasSelectedLayers
                      ? `Selected: ${selectedLayerIndexes.map((i) => getLayerInfo(mapFeatures[i], i).name).join(", ")}`
                      : "Click to select map layer (Required)"}
                  </TooltipContent>
                </Tooltip>

                {/* Textarea */}
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onClick={() => {
                    if (!hasSelectedLayers) {
                      setShowLayerMenu(true);
                    }
                  }}
                  placeholder={
                    hasSelectedLayers
                      ? selectedLayerIndexes.length === 1
                        ? `Ask about ${getLayerInfo(mapFeatures[selectedLayerIndexes[0]], selectedLayerIndexes[0]).name}...`
                        : `Ask about ${selectedLayerIndexes.length} layers...`
                      : "Select a layer to query..."
                  }
                  rows={1}
                  disabled={mapSqlChat.isLoading}
                  className="flex-1 min-h-[32px] max-h-[72px] bg-background/40 dark:bg-background/30 backdrop-blur-xs border border-border/30 rounded-xl px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/40 transition-all disabled:opacity-50"
                  style={{ overflowY: inputValue.split("\n").length > 2 ? "auto" : "hidden" }}
                />

                {/* Submit Button */}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSubmit}
                  title={
                    !hasSelectedLayers
                      ? "Please select a map layer first"
                      : !inputValue.trim()
                      ? "Type a query to submit"
                      : "Submit SQL query (Enter)"
                  }
                  className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-150 ${
                    canSubmit
                      ? "bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:scale-105 active:scale-95 cursor-pointer"
                      : "bg-muted/25 text-muted-foreground/30 cursor-not-allowed border border-border/15"
                  }`}
                >
                  {mapSqlChat.isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ArrowUp className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={closeMapSqlChat}
                  className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  title="Close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─── Message Bubble ──────────────────────────────────────────────

const MessageBubble = ({ message }: { message: ChatMessage }) => {
  const isUser = message.role === "user";

  if (message.isLoading) {
    return (
      <div className="flex items-start gap-2 max-w-[92%] animate-in fade-in slide-in-from-bottom-2 duration-150">
        <div className="w-6 h-6 shrink-0 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center mt-0.5 shadow-sm">
          <Bot className="w-3.5 h-3.5 text-cyan-500" />
        </div>
        <div className="bg-background/95 dark:bg-card/95 backdrop-blur-xl border border-border/70 dark:border-border/60 shadow-lg shadow-black/15 rounded-2xl rounded-tl-sm px-3.5 py-2 flex flex-col gap-1 w-full min-w-0">
          {renderAgentEvents(message.agentEvents, true)}
          {message.statusMessage && (
            <span className="text-[10.5px] text-muted-foreground italic font-medium">
              {message.statusMessage}
            </span>
          )}
          {message.content ? (
            <div className="text-[12px] text-foreground leading-relaxed w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
              <MarkdownRenderer content={cleanMessageContent(message.content)} />
            </div>
          ) : (
            <div className="flex items-center gap-2 py-0.5">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:300ms]" />
              </div>
              <span className="text-[10.5px] text-muted-foreground font-medium">Thinking...</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isUser) {
    const cleaned = cleanMessageContent(message.content);
    if (!cleaned) return null;
    return (
      <div className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-150">
        <div className="max-w-[85%] bg-primary text-primary-foreground shadow-md shadow-primary/25 rounded-2xl rounded-br-sm px-3.5 py-2">
          <p className="text-[12px] leading-relaxed whitespace-pre-wrap break-words font-medium">
            {cleaned}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 max-w-[92%] animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="w-6 h-6 shrink-0 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center mt-0.5 shadow-sm">
        <Bot className="w-3.5 h-3.5 text-cyan-500" />
      </div>
      <div className="flex-1 bg-background/95 dark:bg-card/95 backdrop-blur-xl border border-border/70 dark:border-border/60 shadow-lg shadow-black/15 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[12px] text-foreground leading-relaxed prose-sm [&_pre]:text-[10.5px] [&_code]:text-[10.5px] [&_table]:text-[10.5px] [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-xs [&_h2]:text-xs [&_h3]:text-[11px] overflow-hidden">
        {renderAgentEvents(message.agentEvents, false)}
        <MarkdownRenderer content={cleanMessageContent(message.content)} />
      </div>
    </div>
  );
};
