"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useChatStore } from "@/stores/useChatStore";
import { useMapStore } from "@/stores/useMapStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { X, Trash2, ChevronDown, ChevronRight, ChevronUp, Copy, Download, Table2, Code, Map, Layers, Check, CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { QueryResultData, VisualizationLayerType, SuggestedVisualizationLayer } from "@/types/mcp.types";
import { saveLayer, deleteLayer } from "@/services/layerSyncService";
import { queryResultService, calculateQueryResultSize, TEN_MB_BYTES } from "@/services/queryResultService";
import { convertQueryResultToFeatures, isSpatialQueryResult } from "@/utils/spatialQueryHelper";

/**
 * QueryResultsPanel
 * ─────────────────────────────────────────────────────────────
 * A slide-out panel on the right side that shows DuckDB query
 * results as stacked table cards. Each query creates a new
 * collapsible card. Data is temporary (client-only, NOT persisted
 * to Supabase).
 * ─────────────────────────────────────────────────────────────
 */

/** Convert query results to CSV string */
function toCSV(columns: string[], rows: any[][]): string {
  const header = columns.map((c) => `"${c}"`).join(",");
  const body = rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return "";
          const str = typeof cell === "object" ? JSON.stringify(cell) : String(cell);
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
  return `${header}\n${body}`;
}

/** Download CSV as file */
function downloadCSV(data: QueryResultData) {
  const csv = toCSV(data.columns, data.rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `query_${data.queryId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Copy CSV to clipboard */
async function copyCSV(data: QueryResultData) {
  const csv = toCSV(data.columns, data.rows);
  await navigator.clipboard.writeText(csv);
}

/** Format cell value for display */
function formatCell(value: any): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "number") {
    // Format large numbers with commas
    if (Number.isInteger(value) && Math.abs(value) >= 1000) {
      return value.toLocaleString();
    }
    // Round floats to 4 decimal places
    if (!Number.isInteger(value)) {
      return Number(value.toFixed(4)).toLocaleString();
    }
  }
  return String(value);
}

/** Truncate long SQL for display */
function truncateSQL(sql: string, maxLen = 80): string {
  // Remove INSTALL/LOAD lines for cleaner display
  const cleaned = sql
    .replace(/INSTALL\s+\w+;\s*/gi, "")
    .replace(/LOAD\s+\w+;\s*/gi, "")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen) + "…";
}

/**
 * Extract coordinate data from query result rows for visualization layers.
 * Handles three cases:
 * 1. Origin-Destination (OD) pairs (e.g. pickup_lng, dropoff_lat) for ArcLayer
 * 2. Flat coordinate pairs (e.g. lng, lat) for Hexagon/Scatterplot
 * 3. Spatial column (GeoJSON)
 */
function extractVisualizationData(data: QueryResultData): any[] {
  const results: any[] = [];
  const lowerCols = data.columns.map(c => c.toLowerCase());
  
  // Find coordinate column indices
  const findCol = (patterns: string[]) => lowerCols.findIndex(c => patterns.some(p => c.includes(p)));
  
  const oLngIdx = findCol(["pickup_longitude", "pickup_lng", "start_lng", "origin_lng"]);
  const oLatIdx = findCol(["pickup_latitude", "pickup_lat", "start_lat", "origin_lat"]);
  const dLngIdx = findCol(["dropoff_longitude", "dropoff_lng", "end_lng", "dest_lng"]);
  const dLatIdx = findCol(["dropoff_latitude", "dropoff_lat", "end_lat", "dest_lat"]);
  
  const hasOD = oLngIdx >= 0 && oLatIdx >= 0 && dLngIdx >= 0 && dLatIdx >= 0;
  
  const lngIdx = findCol(["lng", "longitude", "lon"]);
  const latIdx = findCol(["lat", "latitude"]);
  const hasFlatCoords = lngIdx >= 0 && latIdx >= 0;

  const spatialIdx = data.spatialColumnName ? data.columns.indexOf(data.spatialColumnName) : -1;

  if (!hasOD && !hasFlatCoords && spatialIdx === -1) {
    return [];
  }

  data.rows.forEach((row, rowIdx) => {
    try {
      // Build properties for this row
      const properties: any = { featureId: `${data.queryId}_${rowIdx}` };
      data.columns.forEach((col, idx) => { properties[col] = row[idx]; });
      
      const weightProps = Object.fromEntries(
        Object.entries(properties).filter(([, v]) => typeof v === "number")
      );

      // Case 1: Origin-Destination pairs (for ArcLayer)
      if (hasOD && typeof row[oLngIdx] === "number" && typeof row[dLngIdx] === "number") {
        results.push({
          pickup_longitude: row[oLngIdx],
          pickup_latitude: row[oLatIdx],
          dropoff_longitude: row[dLngIdx],
          dropoff_latitude: row[dLatIdx],
          properties,
          weight: 1,
          ...weightProps
        });
        return;
      }

      // Case 2: Flat coordinate pairs (for Hexagon, Scatterplot)
      if (hasFlatCoords && typeof row[lngIdx] === "number" && typeof row[latIdx] === "number") {
        results.push({
          position: [row[lngIdx], row[latIdx]],
          lng: row[lngIdx],
          lat: row[latIdx],
          properties,
          weight: 1,
          ...weightProps
        });
        return;
      }

      // Case 3: GeoJSON spatial column
      if (spatialIdx >= 0) {
        const spatialVal = row[spatialIdx];
        if (!spatialVal) return;
        
        let geom: any = null;
        if (typeof spatialVal === "object" && spatialVal !== null) {
          geom = spatialVal;
        } else if (typeof spatialVal === "string") {
          let cleaned = spatialVal.trim();
          if (cleaned.startsWith('"{"\'')) {
            cleaned = cleaned.substring(1, cleaned.length - 1).replace(/""/g, '"');
          }
          if (cleaned.startsWith("{")) {
            geom = JSON.parse(cleaned);
          }
        }

        if (!geom) return;

        if (geom.type === "Point" && Array.isArray(geom.coordinates)) {
          results.push({
            position: geom.coordinates,
            coordinates: geom.coordinates,
            geometry: geom,
            properties,
            weight: 1,
            ...weightProps
          });
        } else {
          results.push({
            geometry: geom,
            properties,
            type: "Feature",
          });
        }
      }
    } catch (e) {
      // Skip malformed rows
    }
  });

  return results;
}

/** Single query result card */
function QueryCard({ data, index }: { data: QueryResultData; index: number }) {
  const [expanded, setExpanded] = useState(index === 0); // First card auto-expanded
  const [copied, setCopied] = useState(false);
  const [showSQL, setShowSQL] = useState(false);
  const [showLayerSelector, setShowLayerSelector] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 100;
  const totalPages = Math.max(1, Math.ceil(data.rows.length / PAGE_SIZE));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, data.rows.length);
  const visibleRows = data.rows.length > PAGE_SIZE ? data.rows.slice(startIndex, endIndex) : data.rows;
  const layerSelectorRef = useRef<HTMLDivElement>(null);
  
  const layerId = `duckdb_${data.queryId}`;
  const mapFeatureIdx = useMapStore((state) =>
    state.mapFeatures.findIndex(
      (f) =>
        f?.properties?.layerId === layerId ||
        f?.features?.some((feat: any) => feat?.properties?._layerId === layerId || feat?.properties?.featureId?.startsWith(data.queryId))
    )
  );
  const isOnMap = mapFeatureIdx !== -1;
  const isDrawnOnMap = isOnMap;
  const currentLayerType = useMapStore((state) =>
    mapFeatureIdx !== -1 ? state.mapFeatureLayerTypes[mapFeatureIdx] || "GeoJsonLayer" : null
  );
  const isVisualized = currentLayerType !== null && currentLayerType !== "GeoJsonLayer";

  const handleCopy = async () => {
    await copyCSV(data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const timeStr = new Date(data.timestamp).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const { bytes: dataBytes, formatted: dataSizeFormatted } = React.useMemo(
    () => calculateQueryResultSize(data),
    [data]
  );
  const isLargeData = dataBytes > TEN_MB_BYTES;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (layerSelectorRef.current && !layerSelectorRef.current.contains(e.target as Node)) {
        setShowLayerSelector(false);
      }
    };
    if (showLayerSelector) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showLayerSelector]);

  /** Apply features directly to Map Layers (adds to mapFeatures, supports visualization types, and persists to Supabase) */
  const applyResultToMap = (layerType: VisualizationLayerType = "GeoJsonLayer") => {
    const mapStore = useMapStore.getState();
    const layerId = `duckdb_${data.queryId}`;
    const cleanSql = truncateSQL(data.queryText, 30);
    const layerTitle = `Query: ${cleanSql}`;

    // 1. Extract GeoJSON features using our spatial helper
    const features = convertQueryResultToFeatures(data);
    if (features.length === 0) {
      toast.error("No valid spatial coordinates or geometry found in query result");
      return;
    }

    // Attach _layerId to each feature so it can always be identified even if individual features are processed
    features.forEach((f) => {
      if (f.properties) {
        f.properties._layerId = layerId;
      }
    });

    const featureCollection = {
      type: "FeatureCollection",
      features,
      properties: {
        title: layerTitle,
        name: layerTitle,
        source: "duckdb",
        source_url: "duckdb",
        layerId,
        rowCount: features.length,
      },
    };

    // 2. Add or update in mapFeatures (ONLY single layer source of truth)
    const existingIdx = mapStore.mapFeatures.findIndex(
      (f) =>
        f?.properties?.layerId === layerId ||
        f?.features?.some((feat: any) => feat?.properties?._layerId === layerId)
    );

    let targetIndex: number;
    if (existingIdx !== -1) {
      const updated = [...mapStore.mapFeatures];
      updated[existingIdx] = featureCollection;
      mapStore.setMapFeatures(updated);
      targetIndex = existingIdx;
    } else {
      targetIndex = mapStore.mapFeatures.length;
      mapStore.setMapFeatures([...mapStore.mapFeatures, featureCollection]);
    }

    // 3. Configure visualization layer type for this map layer
    if (layerType && layerType !== "GeoJsonLayer") {
      mapStore.setMapFeatureLayerType(targetIndex, layerType);
    } else {
      mapStore.clearMapFeatureLayerType(targetIndex);
    }

    // Ensure NO duplicate layer in visualizationLayers
    mapStore.removeVisualizationLayer(data.queryId);

    // 4. Persist to Supabase in background so the layer stays across reloads
    const activeSessionId = useChatStore.getState().activeSessionId;
    if (activeSessionId && !activeSessionId.startsWith("shared-")) {
      saveLayer(activeSessionId, targetIndex, layerTitle, featureCollection).catch((err) => {
        console.warn("[QueryResultsPanel] Failed to persist layer to Supabase:", err);
      });
    }

    mapStore.triggerZoomToFit();
    toast.success(`Added "${layerTitle}" (${features.length} features) to Map Layers`);
    setShowLayerSelector(false);
  };

  /** Remove all visualization and layers from map */
  const removeFromMap = () => {
    const mapStore = useMapStore.getState();
    const layerId = `duckdb_${data.queryId}`;
    
    // 1. Remove from mapFeatures and persist deletion
    const layerIdx = mapStore.mapFeatures.findIndex(
      (f) =>
        f?.properties?.layerId === layerId ||
        f?.features?.some((feat: any) => feat?.properties?._layerId === layerId)
    );

    if (layerIdx !== -1) {
      const filteredFeatures = mapStore.mapFeatures.filter((_, i) => i !== layerIdx);
      mapStore.setMapFeatures(filteredFeatures);
      mapStore.clearMapFeatureLayerType(layerIdx);

      const activeSessionId = useChatStore.getState().activeSessionId;
      if (activeSessionId && !activeSessionId.startsWith("shared-")) {
        deleteLayer(activeSessionId, layerIdx).catch((err) => {
          console.warn("[QueryResultsPanel] Failed to delete layer from Supabase:", err);
        });
      }
    }

    // 2. Remove visualization layer if any
    mapStore.removeVisualizationLayer(data.queryId);
    mapStore.setHoverInfo(null);
    mapStore.setLockedHoverInfo(null);
    toast.success("Removed from map");
  };

  /** Handle "View on Map" primary click */
  const handleViewOnMap = () => {
    if (isOnMap) {
      removeFromMap();
      return;
    }

    const suggestions = data.suggestedLayers;
    if (suggestions && suggestions.length > 1) {
      // Multiple options → show selector
      setShowLayerSelector(true);
    } else if (suggestions && suggestions.length === 1) {
      // Single suggestion → apply directly
      applyResultToMap(suggestions[0].type);
    } else {
      // No suggestions → use GeoJsonLayer (default)
      applyResultToMap("GeoJsonLayer");
    }
  };


  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
      {/* Card Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-muted-foreground truncate">
            {truncateSQL(data.queryText)}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={cn(
                "px-1.5 py-0.2 text-[9px] font-semibold rounded uppercase tracking-wider",
                (data.toolName === "client_duckdb" || data.toolName === "run_client_duckdb_query")
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                  : "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30"
              )}
            >
              {(data.toolName === "client_duckdb" || data.toolName === "run_client_duckdb_query")
                ? "Client Wasm"
                : "Backend"}
            </span>
            <span className="text-[11px] font-medium text-foreground">
              {data.totalRowCount.toLocaleString()} row{data.totalRowCount !== 1 ? "s" : ""}
            </span>
            <span className="text-[10px] text-muted-foreground">•</span>
            <span className="text-[11px] text-muted-foreground">
              {data.columns.length} col{data.columns.length !== 1 ? "s" : ""}
            </span>
            {data.executionTimeMs !== undefined && (
              <>
                <span className="text-[10px] text-muted-foreground">•</span>
                <span className="text-[11px] text-muted-foreground">{data.executionTimeMs}ms</span>
              </>
            )}
            <span className="text-[10px] text-muted-foreground">•</span>
            <span className="text-[11px] text-muted-foreground">{timeStr}</span>
            <span className="text-[10px] text-muted-foreground">•</span>
            <span
              className={cn(
                "text-[11px] font-medium",
                isLargeData
                  ? "text-amber-500 font-semibold flex items-center gap-1"
                  : "text-muted-foreground"
              )}
              title={
                isLargeData
                  ? `Data size: ${dataSizeFormatted} (Exceeds 10 MB limit)`
                  : `Data size: ${dataSizeFormatted}`
              }
            >
              {isLargeData && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              )}
              {dataSizeFormatted}
            </span>
            {data.truncated && (
              <>
                <span className="text-[10px] text-muted-foreground">•</span>
                <span className="text-[11px] text-amber-500 font-medium">truncated</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toast.promise(
              useChatStore.getState().removeQueryResult(data.queryId),
              {
                loading: 'Removing...',
                success: 'Removed successfully',
                error: 'Failed to remove'
              }
            );
          }}
          className="p-1.5 ml-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
          title="Delete result"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Card Body — Scrollable Table or SQL */}
      {expanded && (
        <div className="border-t border-border">
          {showSQL ? (
            <div className="p-3 bg-muted/20 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5" />
                  Generated SQL
                </span>
              </div>
              <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 p-2 bg-muted/40 rounded border border-border">
                {data.queryText}
              </pre>
            </div>
          ) : (
            <div className="overflow-auto max-h-[300px] scrollbar-thin scrollbar-thumb-muted-foreground/20">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted/80 backdrop-blur-sm">
                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border w-8">
                    #
                  </th>
                  {data.columns.map((col, i) => (
                    <th
                      key={i}
                      className="px-2 py-1.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, relativeIdx) => {
                  const rowIdx = data.rows.length > PAGE_SIZE ? startIndex + relativeIdx : relativeIdx;
                  const featureId = `${data.queryId}_${rowIdx}`;
                  return (
                    <tr
                      key={rowIdx}
                      onMouseEnter={() => {
                        if (isDrawnOnMap) {
                          useMapStore.getState().setHighlightedFeatureId(featureId);
                        }
                      }}
                      onMouseLeave={() => {
                        if (isDrawnOnMap) {
                          useMapStore.getState().setHighlightedFeatureId(null);
                        }
                      }}
                      onClick={() => {
                        if (isDrawnOnMap) {
                          const mapFeatures = useMapStore.getState().mapFeatures;
                          for (const featureCol of mapFeatures) {
                            if (featureCol.properties?.layerId === `duckdb_${data.queryId}`) {
                              const feature = featureCol.features.find((f: any) => f.properties?.featureId === featureId);
                              if (feature) {
                                useMapStore.getState().zoomToFeatureBoundingBox(feature);
                              }
                              break;
                            }
                          }
                        }
                      }}
                      onDoubleClick={async (e) => {
                        if (isDrawnOnMap) {
                          const state = useMapStore.getState();
                          const mapFeatures = state.mapFeatures;
                          let targetFeature: any = null;
                          let layerIndex: number = -1;
                          let featureIndex: number = -1;
                          for (let i = 0; i < mapFeatures.length; i++) {
                            const featureCol = mapFeatures[i];
                            if (featureCol.properties?.layerId === `duckdb_${data.queryId}`) {
                              featureIndex = featureCol.features.findIndex((f: any) => f.properties?.featureId === featureId);
                              if (featureIndex !== -1) {
                                targetFeature = featureCol.features[featureIndex];
                                layerIndex = i;
                              }
                              break;
                            }
                          }
                          
                          if (targetFeature) {
                            try {
                              const turf = await import('@turf/turf');
                              const center = turf.center(targetFeature);
                              const [lng, lat] = center.geometry.coordinates;
                              
                              const { WebMercatorViewport } = await import('@deck.gl/core');
                              // Project the geographic center to screen coordinates based on current map view
                              const viewport = new WebMercatorViewport({
                                width: window.innerWidth || 800,
                                height: window.innerHeight || 600,
                                longitude: state.viewState.longitude,
                                latitude: state.viewState.latitude,
                                zoom: state.viewState.zoom,
                                pitch: state.viewState.pitch,
                                bearing: state.viewState.bearing
                              });
                              
                              const [x, y] = viewport.project([lng, lat]);
                              
                              state.setLockedHoverInfo({
                                props: { ...targetFeature.properties, _layerIndex: layerIndex, _featureIndex: featureIndex },
                                x,
                                y,
                                lng,
                                lat
                              });
                            } catch (err) {
                              console.error("Failed to project feature center", err);
                              // Fallback to mouse position if projection fails
                              state.setLockedHoverInfo({
                                props: { ...targetFeature.properties, _layerIndex: layerIndex, _featureIndex: featureIndex },
                                x: e.clientX > window.innerWidth - 300 ? e.clientX - 280 : e.clientX + 15,
                                y: e.clientY
                              });
                            }
                          }
                        }
                      }}
                      className={`${rowIdx % 2 === 0 ? "bg-background" : "bg-muted/30"} hover:bg-primary/5 transition-colors ${isDrawnOnMap ? 'cursor-pointer' : ''}`}
                    >
                      <td className="px-2 py-1 text-muted-foreground/60 border-b border-border/50 font-mono">
                        {rowIdx + 1}
                      </td>
                      {row.map((cell, cellIdx) => (
                        <td
                          key={cellIdx}
                          className="px-2 py-1 border-b border-border/50 whitespace-nowrap max-w-[200px] truncate font-mono"
                          title={formatCell(cell)}
                        >
                          {formatCell(cell)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}

          {/* Pagination Controls when dataset has more than PAGE_SIZE rows */}
          {data.rows.length > PAGE_SIZE && !showSQL && (
            <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/60 bg-muted/20 text-[11px] text-muted-foreground">
              <span>
                Showing <strong className="text-foreground">{startIndex + 1}–{endIndex}</strong> of {data.rows.length.toLocaleString()} rows
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-2 py-0.5 rounded border border-border bg-background hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[10px] font-medium"
                >
                  Previous
                </button>
                <span className="px-1.5 text-[10px] font-semibold text-foreground">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2 py-0.5 rounded border border-border bg-background hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[10px] font-medium"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Card Footer — Actions */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/30">
            <button
              onClick={() => setShowSQL(!showSQL)}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Code className="w-3 h-3" />
              {showSQL ? "Show Data" : "View SQL"}
            </button>
            <div className="w-px h-3 bg-border mx-1"></div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            >
              <Copy className="w-3 h-3" />
              {copied ? "Copied!" : "Copy CSV"}
            </button>
            <button
              onClick={() => downloadCSV(data)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            >
              <Download className="w-3 h-3" />
              Download CSV
            </button>

            {isLargeData && (
              <>
                <div className="w-px h-3 bg-border mx-1"></div>
                <button
                  onClick={() => {
                    const activeSessionId = useChatStore.getState().activeSessionId;
                    const user = useAuthStore.getState().user;
                    if (!user || !activeSessionId) {
                      toast.error("Please log in to save query results to cloud.");
                      return;
                    }
                    const savePromise = queryResultService.saveResult(user.id, activeSessionId, data, true);
                    toast.promise(savePromise, {
                      loading: `Saving query result (${dataSizeFormatted}) to cloud...`,
                      success: `Query result (${dataSizeFormatted}) saved to cloud`,
                      error: (err: any) => `Failed to save: ${err?.message || "Storage error"}`,
                    });
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 rounded transition-colors"
                  title="Save this large result to Supabase cloud"
                >
                  <CloudUpload className="w-3 h-3" />
                  Save to Cloud
                </button>
              </>
            )}
            
            {isSpatialQueryResult(data) && (
              <>
                <div className="w-px h-3 bg-border mx-1"></div>
                <div className="relative" ref={layerSelectorRef}>
                  {/* Main View on Map button */}
                  <div className="flex items-center">
                    <button
                      onClick={handleViewOnMap}
                      className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-l transition-colors ${
                        isOnMap
                          ? "text-blue-500 hover:bg-blue-500/10"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      {isVisualized ? (
                        <Layers className="w-3 h-3" />
                      ) : (
                        <Map className="w-3 h-3" />
                      )}
                      {isOnMap
                        ? (isVisualized && currentLayerType
                            ? `Hide ${currentLayerType.replace("Layer", "")}`
                            : "Hide from Map")
                        : "View on Map"}
                    </button>

                    {/* Dropdown toggle — only show when spatial + has suggestions */}
                    {data.suggestedLayers && data.suggestedLayers.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowLayerSelector(!showLayerSelector);
                        }}
                        className={`flex items-center px-1 py-1 text-[11px] rounded-r border-l border-border/50 transition-colors ${
                          isOnMap
                            ? "text-blue-500 hover:bg-blue-500/10"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                        title="Choose visualization type"
                      >
                        {showLayerSelector ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Layer Selector Dropdown */}
                  {showLayerSelector && data.suggestedLayers && (
                    <div className="absolute bottom-full left-0 mb-1 w-64 bg-background border border-border rounded-lg shadow-xl z-50 overflow-hidden animate-in slide-in-from-bottom-2 duration-150">
                      <div className="px-3 py-2 border-b border-border bg-muted/40">
                        <p className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-primary" />
                          Choose Visualization Layer
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">
                          AI-recommended based on {data.totalRowCount.toLocaleString()} rows
                        </p>
                      </div>
                      <div className="py-1 max-h-[240px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20">
                        {data.suggestedLayers.map((layer, idx) => {
                          const isActive =
                            isOnMap &&
                            (currentLayerType === layer.type ||
                              (!currentLayerType && layer.type === "GeoJsonLayer"));
                          return (
                            <button
                              key={idx}
                              onClick={() => applyResultToMap(layer.type)}
                              className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                                isActive
                                  ? "bg-primary/10 text-primary"
                                  : "hover:bg-muted/50 text-foreground"
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-medium">{layer.label}</span>
                                  {layer.isPrimary && (
                                    <span className="text-[8px] font-bold bg-primary/15 text-primary px-1 py-0.5 rounded uppercase">
                                      Best
                                    </span>
                                  )}
                                </div>
                                <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">
                                  {layer.description}
                                </p>
                              </div>
                              {isActive && (
                                <Check className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {data.truncated && (
              <span className="ml-auto text-[10px] text-amber-500">
                Showing {data.rowCount.toLocaleString()} of {data.totalRowCount.toLocaleString()} rows
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Main panel component */
export function QueryResultsPanel() {
  const queryResultsPanel = useChatStore((state) => state.queryResultsPanel);
  const isQueryPanelOpen = useChatStore((state) => state.isQueryPanelOpen);
  const clearQueryResults = useChatStore((state) => state.clearQueryResults);
  const toggleQueryPanel = useChatStore((state) => state.toggleQueryPanel);

  // Resizable panel logic
  const [panelWidth, setPanelWidth] = useState(420);
  const isResizing = useRef(false);

  const panelRef = useRef<HTMLDivElement>(null);

  const startResizing = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    e.preventDefault();
  }, []);

  const stopResizing = useCallback(() => {
    if (isResizing.current && panelRef.current) {
      // Save the final width to state when drag ends
      setPanelWidth(parseInt(panelRef.current.style.width, 10));
    }
    isResizing.current = false;
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing.current && panelRef.current) {
      // Direct DOM update for instant 60fps response (no React state lag)
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 300 && newWidth <= window.innerWidth * 0.9) {
        panelRef.current.style.width = `${newWidth}px`;
        panelRef.current.style.transition = "none"; // Disable any CSS transition during drag
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  if (!isQueryPanelOpen) return null;

  return (
    <div
      ref={panelRef}
      style={{ width: panelWidth, transition: isResizing.current ? "none" : undefined }}
      className="absolute top-16 right-2 bottom-2 z-30 flex flex-col bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden animate-in slide-in-from-right-5 duration-200"
    >
      {/* Resizer Handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 transition-colors z-40"
        onMouseDown={startResizing}
      />

      {/* Panel Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2">
          <Table2 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Query Results</h3>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
            {queryResultsPanel.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearQueryResults}
            className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
            title="Clear all results"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={toggleQueryPanel}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            title="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Panel Body — Stacked Cards */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-muted-foreground/20">
        {queryResultsPanel.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-muted-foreground">
            <Table2 className="w-8 h-8 mb-2 opacity-40 text-primary" />
            <p className="text-xs font-semibold text-foreground">No Query Results Yet</p>
            <p className="text-[11px] mt-1 text-muted-foreground max-w-[240px] leading-relaxed">
              Ask Mapsense AI to analyze data to view query results here.
            </p>
          </div>
        ) : (
          queryResultsPanel.map((result, idx) => (
            <QueryCard key={result.queryId} data={result} index={idx} />
          ))
        )}
      </div>
    </div>
  );
}
