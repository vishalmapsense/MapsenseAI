"use client";

import React, { useState } from "react";
import { FlyToInterpolator } from "@deck.gl/core";
import { useMapStore } from "@/stores/useMapStore";
import type { VisualizationLayerType } from "@/types/mcp.types";
import { ALL_LAYER_TYPES } from "@/utils/layerTypeApplicability";
import { 
  SlidersHorizontal, 
  Palette, 
  X, 
  ChevronDown, 
  ChevronUp, 
  RotateCcw, 
  Sparkles,
  Layers,
  Check
} from "lucide-react";

interface LayerConfigPanelProps {
  layerIndex: number;
  layerType: VisualizationLayerType;
  layerName?: string;
  onClose?: () => void;
  onSwitchLayerType?: (type: VisualizationLayerType) => void;
  applicableLayerTypes?: VisualizationLayerType[];
}

// Curated high-aesthetic color ramps for density visualizations
const COLOR_RAMPS: { name: string; colors: [number, number, number][] }[] = [
  {
    name: "Classic (Blue-Red)",
    colors: [
      [1, 152, 189],
      [73, 227, 206],
      [216, 254, 181],
      [254, 237, 177],
      [254, 173, 84],
      [209, 55, 78],
    ],
  },
  {
    name: "Viridis (Purple-Yellow)",
    colors: [
      [68, 1, 84],
      [65, 68, 135],
      [42, 120, 142],
      [34, 168, 132],
      [122, 209, 81],
      [253, 231, 37],
    ],
  },
  {
    name: "Plasma (Blue-Pink-Yellow)",
    colors: [
      [13, 8, 135],
      [70, 3, 159],
      [114, 1, 168],
      [156, 23, 158],
      [189, 55, 134],
      [216, 87, 107],
    ],
  },
  {
    name: "Inferno (Dark-Orange-Yellow)",
    colors: [
      [0, 0, 4],
      [40, 11, 83],
      [101, 21, 110],
      [159, 42, 99],
      [212, 72, 66],
      [245, 125, 21],
    ],
  },
  {
    name: "Emerald (Teal-Green)",
    colors: [
      [237, 248, 251],
      [178, 226, 226],
      [102, 194, 164],
      [65, 174, 118],
      [35, 139, 69],
      [0, 88, 36],
    ],
  },
  {
    name: "Sunset (Gold-Crimson)",
    colors: [
      [255, 237, 160],
      [254, 178, 76],
      [253, 141, 60],
      [240, 59, 32],
      [189, 0, 38],
      [128, 0, 38],
    ],
  },
];

export const LayerConfigPanel: React.FC<LayerConfigPanelProps> = ({ 
  layerIndex, 
  layerType,
  layerName,
  onClose,
  onSwitchLayerType,
  applicableLayerTypes = []
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showTypeSwitcher, setShowTypeSwitcher] = useState(false);

  const mapFeatureLayerConfigs = useMapStore((state) => state.mapFeatureLayerConfigs);
  const setMapFeatureLayerConfig = useMapStore((state) => state.setMapFeatureLayerConfig);
  const resetMapFeatureLayerConfig = useMapStore((state) => state.resetMapFeatureLayerConfig);
  const viewState = useMapStore((state) => state.viewState);
  const setViewState = useMapStore((state) => state.setViewState);

  const config = mapFeatureLayerConfigs[layerIndex] || {};

  // Supported attribute flags by layer type
  const hasRadius = ["HexagonLayer", "GridLayer", "ColumnLayer", "ContourLayer", "ScatterplotLayer"].includes(layerType);
  const hasElevation = ["HexagonLayer", "GridLayer", "ColumnLayer", "H3HexagonLayer", "GeohashLayer", "SolidPolygonLayer"].includes(layerType);
  const hasCoverage = ["HexagonLayer", "GridLayer", "H3HexagonLayer"].includes(layerType);
  const hasIntensity = layerType === "HeatmapLayer";
  const hasColorRange = ["HexagonLayer", "HeatmapLayer", "GridLayer", "ScreenGridLayer", "ContourLayer", "SolidPolygonLayer"].includes(layerType);
  const hasExtrusion = ["HexagonLayer", "GridLayer", "SolidPolygonLayer", "H3HexagonLayer", "GeohashLayer"].includes(layerType);

  const isExtruded = config.extruded !== undefined ? Boolean(config.extruded) : true;

  const tiltTo3D = () => {
    setViewState({
      ...viewState,
      pitch: 55,
      bearing: viewState.bearing || 15,
      transitionDuration: 600,
      transitionInterpolator: new FlyToInterpolator(),
    });
  };

  const updateConfig = (key: string, value: any) => {
    setMapFeatureLayerConfig(layerIndex, { [key]: value });
  };

  const handleToggleExtruded = () => {
    const nextVal = !isExtruded;
    updateConfig("extruded", nextVal);
    if (nextVal && viewState.pitch === 0) {
      tiltTo3D();
    }
  };

  const handleElevationChange = (val: number) => {
    updateConfig("elevationScale", val);
    if (isExtruded && viewState.pitch === 0) {
      tiltTo3D();
    }
  };

  const handleReset = () => {
    resetMapFeatureLayerConfig(layerIndex);
  };

  const typeMeta = ALL_LAYER_TYPES.find((t) => t.type === layerType);
  const displayTypeName = typeMeta?.shortLabel || layerType.replace("Layer", "");

  return (
    <div className="w-80 max-w-[calc(100vw-2rem)] bg-background/95 backdrop-blur-md border border-border/80 rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs transition-all duration-200">
      {/* Header Bar */}
      <div className="px-3.5 py-2.5 bg-muted/60 border-b border-border/60 flex items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="p-1 rounded-md bg-primary/10 text-primary flex-shrink-0">
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-foreground truncate max-w-[130px]" title={layerName || `Layer ${layerIndex + 1}`}>
                {layerName || `Layer ${layerIndex + 1}`}
              </span>
              {/* Layer Type Badge (Clickable to switch if switcher available) */}
              {onSwitchLayerType && applicableLayerTypes.length > 1 ? (
                <button
                  onClick={() => setShowTypeSwitcher(!showTypeSwitcher)}
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/15 hover:bg-primary/25 text-primary flex items-center gap-1 transition-colors"
                  title="Switch visualization layer type"
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  {displayTypeName}
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/15 text-primary flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  {displayTypeName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            title={isCollapsed ? "Expand settings" : "Minimize"}
          >
            {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              title="Close panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Layer Type Switcher Dropdown (Popover from Header) */}
      {showTypeSwitcher && onSwitchLayerType && (
        <div className="p-2 border-b border-border bg-background/95">
          <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5 px-1 flex items-center gap-1">
            <Layers className="w-3 h-3 text-primary" />
            Select Visualization Type
          </div>
          <div className="grid grid-cols-3 gap-1">
            {ALL_LAYER_TYPES.map((lt) => {
              const isApplicable = applicableLayerTypes.includes(lt.type);
              const isActive = layerType === lt.type;
              return (
                <button
                  key={lt.type}
                  disabled={!isApplicable}
                  onClick={() => {
                    if (!isApplicable) return;
                    onSwitchLayerType(lt.type);
                    setShowTypeSwitcher(false);
                  }}
                  className={`px-1.5 py-1.5 rounded text-[10px] font-medium leading-tight text-center transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground ring-1 ring-primary shadow-sm"
                      : isApplicable
                        ? "bg-card text-foreground hover:bg-muted hover:ring-1 hover:ring-primary/40 cursor-pointer border border-border/50"
                        : "bg-muted/20 text-muted-foreground/40 cursor-not-allowed opacity-50"
                  }`}
                  title={isApplicable ? lt.description : `Not applicable: ${lt.description}`}
                >
                  {lt.shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Controls Body */}
      {!isCollapsed && (
        <div className="p-3.5 space-y-3.5 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20">
          {/* OPACITY SLIDER */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-muted-foreground">
              <span className="font-medium">Opacity</span>
              <span className="font-mono text-foreground font-semibold">
                {((config.opacity ?? 0.8) * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min="0.05"
              max="1.0"
              step="0.05"
              value={config.opacity ?? 0.8}
              onChange={(e) => updateConfig("opacity", parseFloat(e.target.value))}
              className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>

          {/* RADIUS / CELL SIZE */}
          {hasRadius && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-muted-foreground">
                <span className="font-medium">
                  {layerType === "ScatterplotLayer" ? "Point Radius" : "Cell Size (Radius)"}
                </span>
                <span className="font-mono text-foreground font-semibold">
                  {config.radius ?? (layerType === "ScatterplotLayer" ? 30 : 200)}
                  {layerType === "ScatterplotLayer" ? "px" : "m"}
                </span>
              </div>
              <input
                type="range"
                min={layerType === "ScatterplotLayer" ? 2 : 20}
                max={layerType === "ScatterplotLayer" ? 500 : 2500}
                step={layerType === "ScatterplotLayer" ? 1 : 20}
                value={config.radius ?? (layerType === "ScatterplotLayer" ? 30 : 200)}
                onChange={(e) => updateConfig("radius", parseInt(e.target.value, 10) || (layerType === "ScatterplotLayer" ? 30 : 200))}
                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
          )}

          {/* COVERAGE (GAP BETWEEN CELLS) */}
          {hasCoverage && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-muted-foreground">
                <span className="font-medium">Coverage</span>
                <span className="font-mono text-foreground font-semibold">
                  {((config.coverage ?? 0.9) * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={config.coverage ?? 0.9}
                onChange={(e) => updateConfig("coverage", parseFloat(e.target.value))}
                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
          )}

          {/* 3D EXTRUSION & ELEVATION SCALE */}
          {hasElevation && (
            <div className="space-y-2.5 pt-1 border-t border-border/40">
              {hasExtrusion && (
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground">3D Extrusion</span>
                    {isExtruded && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-primary/15 text-primary font-semibold">
                        3D
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleToggleExtruded}
                    className={`w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 ${
                      isExtruded ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                        isExtruded ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              )}

              {isExtruded && (
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-muted-foreground">
                    <span className="font-medium">Elevation Scale</span>
                    <span className="font-mono text-foreground font-semibold">
                      {config.elevationScale ?? 4}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max={layerType === "SolidPolygonLayer" ? 100 : 50}
                    step="0.5"
                    value={config.elevationScale ?? 4}
                    onChange={(e) => handleElevationChange(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  {viewState.pitch === 0 && (
                    <button
                      onClick={tiltTo3D}
                      className="w-full mt-1 px-2 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-500 border border-sky-500/30 text-[10px] font-medium flex items-center justify-center gap-1 transition-colors"
                      title="Tilt map to 3D perspective"
                    >
                      <span>Map is in 2D (top-down). Click to tilt to 3D view</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* HEATMAP INTENSITY & BLUR */}
          {hasIntensity && (
            <div className="space-y-3 pt-1 border-t border-border/40">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span className="font-medium">Heat Intensity</span>
                  <span className="font-mono text-foreground font-semibold">
                    {config.intensity ?? 1}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={config.intensity ?? 1}
                  onChange={(e) => updateConfig("intensity", parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span className="font-medium">Blur Radius</span>
                  <span className="font-mono text-foreground font-semibold">
                    {config.radiusPixels ?? 30}px
                  </span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={config.radiusPixels ?? 30}
                  onChange={(e) => updateConfig("radiusPixels", parseInt(e.target.value))}
                  className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
              </div>
            </div>
          )}

          {/* COLOR PALETTES */}
          {hasColorRange && (
            <div className="space-y-2 pt-1 border-t border-border/40">
              <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <Palette className="w-3.5 h-3.5 text-primary" />
                Color Palette
              </div>
              <div className="grid grid-cols-2 gap-2">
                {COLOR_RAMPS.map((ramp, i) => {
                  const isActive = config.colorRange
                    ? JSON.stringify(config.colorRange) === JSON.stringify(ramp.colors)
                    : i === 0;

                  return (
                    <button
                      key={ramp.name}
                      onClick={() => updateConfig("colorRange", ramp.colors)}
                      className={`flex flex-col gap-1 p-1.5 rounded-lg border text-left transition-all ${
                        isActive
                          ? "border-primary bg-primary/10 ring-1 ring-primary shadow-sm"
                          : "border-border/60 hover:border-primary/40 bg-card/60"
                      }`}
                      title={ramp.name}
                    >
                      <div className="flex h-3 w-full rounded overflow-hidden">
                        {ramp.colors.map((c, j) => (
                          <div
                            key={j}
                            className="flex-1 h-full"
                            style={{ backgroundColor: `rgb(${c[0]}, ${c[1]}, ${c[2]})` }}
                          />
                        ))}
                      </div>
                      <span className="text-[9px] font-medium text-foreground truncate flex items-center justify-between">
                        {ramp.name.split(" ")[0]}
                        {isActive && <Check className="w-2.5 h-2.5 text-primary flex-shrink-0" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* FOOTER: RESET TO DEFAULTS */}
          <div className="pt-2 border-t border-border/40 flex justify-end">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="Reset all settings to default"
            >
              <RotateCcw className="w-3 h-3" />
              Reset to Defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
