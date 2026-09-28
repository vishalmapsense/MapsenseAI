"use client";

import React, { useState, useEffect } from "react";
import { useMapStore } from "@/stores/useMapStore";
import type { RGBAColor, LayerStyle } from "@/types/layerStyle.types";
import { ChevronDown, ChevronUp, X } from "lucide-react";

/** Convert RGBA to CSS rgba() string */
const rgbaToCss = (c: RGBAColor): string =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] / 255).toFixed(2)})`;

/** Build a CSS linear-gradient string from min/max colors */
const gradientCss = (minC: RGBAColor, maxC: RGBAColor): string =>
  `linear-gradient(to right, ${rgbaToCss(minC)}, ${rgbaToCss(maxC)})`;

/**
 * LayerLegend
 * ─────────────────────────────────────────────────────────────
 * A small floating legend rendered on the map that shows the
 * color mapping for styled layers. Auto-appears when any layer
 * has a style applied. Supports category, gradient, and solid
 * style visualizations. Minimizable and dismissable.
 * ─────────────────────────────────────────────────────────────
 */
export const LayerLegend: React.FC = () => {
  const mapFeatureLayerStyles = useMapStore((s) => s.mapFeatureLayerStyles);
  const mapFeatures = useMapStore((s) => s.mapFeatures);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Automatically reopen legend whenever layer styles change
  useEffect(() => {
    setDismissed(false);
  }, [mapFeatureLayerStyles]);

  // Collect all styled layers
  const styledLayers = Object.entries(mapFeatureLayerStyles)
    .filter(([idx]) => Number(idx) < mapFeatures.length) // Only existing layers
    .map(([idx, style]) => ({
      index: Number(idx),
      style,
      name: extractName(mapFeatures[Number(idx)], Number(idx)),
    }));

  if (styledLayers.length === 0 || dismissed) return null;

  return (
    <div className="absolute bottom-4 left-4 z-30 w-56 bg-background/90 backdrop-blur-md border border-border/70 rounded-xl shadow-xl text-xs font-sans overflow-hidden transition-all duration-200 animate-in slide-in-from-bottom-4 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border/50 select-none">
        <span className="font-semibold text-foreground text-[11px]">Legend</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors"
          >
            {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-3 py-2 space-y-3 max-h-[40vh] overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20">
          {styledLayers.map(({ index, style, name }) => (
            <div key={index} className="space-y-1.5">
              {/* Layer Name */}
              <div className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider truncate" title={name}>
                {name}
              </div>

              {/* Category Legend */}
              {style.type === "category" && (
                <div className="space-y-1">
                  {Object.entries(style.mapping).map(([key, entry]) => {
                    const range = style.ranges?.find((r) => r.category === key);
                    const rangeLabel = range
                      ? range.min !== undefined && range.max !== undefined
                        ? `${range.min}–${range.max}`
                        : range.min !== undefined
                          ? `≥ ${range.min}`
                          : range.max !== undefined
                            ? `< ${range.max}`
                            : ""
                      : "";
                    return (
                      <div key={key} className="flex items-center justify-between gap-1.5 text-[11px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-white/20 shadow-xs"
                            style={{ backgroundColor: rgbaToCss(entry.fillColor) }}
                          />
                          <span className="text-foreground truncate font-medium">
                            {entry.label || key}
                          </span>
                        </div>
                        {rangeLabel && (
                          <span className="text-[9px] font-mono text-muted-foreground bg-muted/60 px-1 rounded border border-border/40 shrink-0">
                            {rangeLabel}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Gradient Legend */}
              {style.type === "gradient" && (
                <div className="space-y-1">
                  <div
                    className="h-2.5 w-full rounded-md border border-border/50"
                    style={{ background: gradientCss(style.minColor, style.maxColor) }}
                  />
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>{style.min}</span>
                    <span className="font-mono">{style.field}</span>
                    <span>{style.max}</span>
                  </div>
                </div>
              )}

              {/* Solid Legend */}
              {style.type === "solid" && (
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-sm border border-white/20"
                    style={{ backgroundColor: rgbaToCss(style.fillColor) }}
                  />
                  <span className="text-muted-foreground">Solid fill</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** Extract a readable name from a GeoJSON feature/collection */
function extractName(geojson: any, layerIndex: number): string {
  if (!geojson) return `Layer ${layerIndex + 1}`;
  const firstFeature =
    geojson?.features?.[0] ||
    (geojson?.type === "Feature" ? geojson : null);
  const props = firstFeature?.properties || {};
  return (
    props.name ||
    props.title ||
    props.instruction ||
    geojson.name ||
    geojson.title ||
    `Layer ${layerIndex + 1}`
  );
}
