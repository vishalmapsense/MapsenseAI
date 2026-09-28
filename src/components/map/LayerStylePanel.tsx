"use client";

import React, { useState, useCallback, useMemo } from "react";
import { useMapStore } from "@/stores/useMapStore";
import type {
  LayerStyle,
  RGBAColor,
  CategoryStyle,
  GradientStyle,
  SolidStyle,
} from "@/types/layerStyle.types";
import {
  Paintbrush,
  X,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Palette,
  Sliders,
  SlidersHorizontal,
  Check,
  Tag,
  Layers,
} from "lucide-react";

interface LayerStylePanelProps {
  layerIndex: number;
  layerName?: string;
  onClose?: () => void;
}

/** Convert RGBA to CSS rgba() string */
const rgbaToCss = (c: RGBAColor): string =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] / 255).toFixed(2)})`;

/** Convert RGBA to hex string (without alpha) */
const rgbaToHex = (c: RGBAColor): string =>
  `#${c[0].toString(16).padStart(2, "0")}${c[1].toString(16).padStart(2, "0")}${c[2].toString(16).padStart(2, "0")}`;

/** Convert hex to RGBA with given alpha */
const hexToRGBA = (hex: string, alpha: number): RGBAColor => {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
    alpha,
  ];
};

/** Format range badge for numerical intervals */
const formatRangeBadge = (min?: number, max?: number): string => {
  if (min !== undefined && max !== undefined) {
    return `${min.toLocaleString()} – ${max.toLocaleString()}`;
  }
  if (min !== undefined) return `≥ ${min.toLocaleString()}`;
  if (max !== undefined) return `< ${max.toLocaleString()}`;
  return "";
};

// ─── Curated Color Palettes ──────────────────────────────────
const CATEGORY_PALETTES: Array<{ name: string; colors: RGBAColor[] }> = [
  {
    name: "Traffic (Best/Avg/Poor)",
    colors: [
      [34, 197, 94, 180],  // Green
      [234, 179, 8, 180],  // Yellow
      [239, 68, 68, 180],  // Red
      [59, 130, 246, 180], // Blue fallback
    ],
  },
  {
    name: "Ocean / Cool",
    colors: [
      [6, 182, 212, 180],  // Cyan
      [59, 130, 246, 180],  // Blue
      [99, 102, 241, 180],  // Indigo
      [168, 85, 247, 180], // Purple
      [236, 72, 153, 180], // Pink
    ],
  },
  {
    name: "Rainbow",
    colors: [
      [34, 197, 94, 180],   // Green
      [20, 184, 166, 180],  // Teal
      [59, 130, 246, 180],  // Blue
      [168, 85, 247, 180],  // Purple
      [249, 115, 22, 180],  // Orange
      [239, 68, 68, 180],   // Red
    ],
  },
  {
    name: "Heatmap",
    colors: [
      [250, 204, 21, 180], // Yellow
      [249, 115, 22, 180],  // Orange
      [239, 68, 68, 180],   // Red
      [159, 18, 57, 180],   // Deep Wine
    ],
  },
];

const GRADIENT_PRESETS: Array<{
  name: string;
  minColor: RGBAColor;
  maxColor: RGBAColor;
}> = [
    {
      name: "Cool to Warm",
      minColor: [59, 130, 246, 180],
      maxColor: [239, 68, 68, 180],
    },
    {
      name: "Green to Red",
      minColor: [34, 197, 94, 180],
      maxColor: [239, 68, 68, 180],
    },
    {
      name: "Red to Green",
      minColor: [239, 68, 68, 180],
      maxColor: [34, 197, 94, 180],
    },
    {
      name: "Viridis",
      minColor: [68, 1, 84, 180],
      maxColor: [253, 231, 37, 180],
    },
    {
      name: "Cyan to Amber",
      minColor: [6, 182, 212, 180],
      maxColor: [245, 158, 11, 180],
    },
  ];

const SOLID_PRESETS: Array<{ name: string; color: RGBAColor; hex: string }> = [
  { name: "Emerald", color: [34, 197, 94, 180], hex: "#22c55e" },
  { name: "Blue", color: [59, 130, 246, 180], hex: "#3b82f6" },
  { name: "Indigo", color: [99, 102, 241, 180], hex: "#6366f1" },
  { name: "Purple", color: [168, 85, 247, 180], hex: "#a855f7" },
  { name: "Pink", color: [236, 72, 153, 180], hex: "#ec4899" },
  { name: "Amber", color: [245, 158, 11, 180], hex: "#f59e0b" },
  { name: "Red", color: [239, 68, 68, 180], hex: "#ef4444" },
  { name: "Slate", color: [100, 116, 139, 180], hex: "#64748b" },
];

export const LayerStylePanel: React.FC<LayerStylePanelProps> = ({
  layerIndex,
  layerName,
  onClose,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const mapFeatures = useMapStore((s) => s.mapFeatures);
  const mapFeatureLayerStyles = useMapStore((s) => s.mapFeatureLayerStyles);
  const setMapFeatureLayerStyle = useMapStore((s) => s.setMapFeatureLayerStyle);
  const clearMapFeatureLayerStyle = useMapStore((s) => s.clearMapFeatureLayerStyle);

  const currentStyle = mapFeatureLayerStyles[layerIndex] || null;
  const layerData = mapFeatures[layerIndex];

  // Features list
  const features = useMemo(() => {
    if (!layerData) return [];
    return layerData.features || (layerData.type === "Feature" ? [layerData] : []);
  }, [layerData]);

  // Extract property columns & determine their data types
  const { availableFields, numericFieldsSet } = useMemo(() => {
    if (features.length === 0) {
      return { availableFields: [], numericFieldsSet: new Set<string>() };
    }
    // Inspect a sample across the first 50 features to find all properties (supports sparse schemas)
    const sampleSize = Math.min(features.length, 50);
    const fieldSet = new Set<string>();
    for (let i = 0; i < sampleSize; i++) {
      const props = features[i]?.properties;
      if (props && typeof props === "object") {
        for (const k in props) {
          if (!k.startsWith("_")) fieldSet.add(k);
        }
      }
    }
    const fields = Array.from(fieldSet);

    // Determine numeric fields using the sample
    const numSet = new Set<string>();
    fields.forEach((field) => {
      let numCount = 0;
      let count = 0;
      for (let i = 0; i < sampleSize; i++) {
        const val = features[i]?.properties?.[field];
        if (val !== undefined && val !== null && val !== "") {
          count++;
          if (!isNaN(Number(val))) numCount++;
        }
      }
      if (count > 0 && numCount / count > 0.7) {
        numSet.add(field);
      }
    });

    return { availableFields: fields, numericFieldsSet: numSet };
  }, [features]);

  // Current active mode tab
  const activeMode: "category" | "gradient" | "solid" = useMemo(() => {
    if (!currentStyle) return "category";
    return currentStyle.type;
  }, [currentStyle]);

  // Active field
  const [localField, setLocalField] = useState<string>("");
  const activeField = useMemo(() => {
    if (currentStyle && (currentStyle.type === "category" || currentStyle.type === "gradient")) {
      return (currentStyle as any).sourceField || currentStyle.field;
    }
    if (localField && availableFields.includes(localField)) return localField;
    // Prefer network_category or category if available
    const pref = availableFields.find((f) =>
      /category|class|status|type|speed|avg/i.test(f)
    );
    return pref || availableFields[0] || "category";
  }, [currentStyle, localField, availableFields]);

  // Calculate current opacity (0-100)
  const currentOpacity = useMemo(() => {
    if (!currentStyle) return 70;
    if (currentStyle.type === "solid") return Math.round((currentStyle.fillColor[3] / 255) * 100);
    if (currentStyle.type === "gradient") return Math.round((currentStyle.maxColor[3] / 255) * 100);
    if (currentStyle.type === "category") {
      const first = Object.values(currentStyle.mapping)[0];
      return first ? Math.round((first.fillColor[3] / 255) * 100) : 70;
    }
    return 70;
  }, [currentStyle]);

  // Alpha helper based on currentOpacity
  const currentAlpha = Math.round((currentOpacity / 100) * 255);

  // ─── Actions ────────────────────────────────────────────────

  // Build category style from a field (optimized for large datasets)
  const applyCategoryStyleForField = useCallback(
    (field: string, palette = CATEGORY_PALETTES[0].colors) => {
      const isNumeric = numericFieldsSet.has(field);

      if (isNumeric) {
        // Collect numeric values efficiently without array duplication or memory bloat
        const nums: number[] = [];
        const total = features.length;

        // For large datasets, sample uniformly up to 10,000 values to calculate percentiles instantly (<2ms)
        // while maintaining <0.5% statistical margin of error.
        if (total > 15000) {
          const step = Math.ceil(total / 10000);
          for (let i = 0; i < total; i += step) {
            const raw = features[i]?.properties?.[field];
            if (raw !== undefined && raw !== null && raw !== "") {
              const n = Number(raw);
              if (!isNaN(n)) nums.push(n);
            }
          }
        } else {
          for (let i = 0; i < total; i++) {
            const raw = features[i]?.properties?.[field];
            if (raw !== undefined && raw !== null && raw !== "") {
              const n = Number(raw);
              if (!isNaN(n)) nums.push(n);
            }
          }
        }

        nums.sort((a, b) => a - b);

        if (nums.length > 0) {
          let p33 = Math.round(nums[Math.floor(nums.length * 0.33)]);
          let p66 = Math.round(nums[Math.floor(nums.length * 0.66)]);

          // If identical percentiles due to low variance or duplicate values, partition by range
          if (p33 === p66) {
            const minV = nums[0];
            const maxV = nums[nums.length - 1];
            if (minV < maxV) {
              const step = (maxV - minV) / 3;
              p33 = Math.round(minV + step);
              p66 = Math.round(minV + 2 * step);
            }
          }

          const updated: CategoryStyle = {
            type: "category",
            field: "category",
            sourceField: field,
            ranges: [
              { min: p66, category: "Best" },
              { min: p33, max: p66, category: "Average" },
              { max: p33, category: "Poor" },
            ],
            mapping: {
              Best: { fillColor: [palette[0][0], palette[0][1], palette[0][2], currentAlpha], label: `Best (≥ ${p66})` },
              Average: { fillColor: [palette[1][0], palette[1][1], palette[1][2], currentAlpha], label: `Average (${p33}–${p66})` },
              Poor: { fillColor: [palette[2][0], palette[2][1], palette[2][2], currentAlpha], label: `Poor (< ${p33})` },
            },
          };
          setMapFeatureLayerStyle(layerIndex, updated);
          return;
        }
      }

      // Categorical / discrete field: count frequencies in a single pass
      const counts = new Map<string, number>();
      const total = features.length;
      // On massive datasets, uniform sampling up to 30,000 items gives representative categories instantly
      const step = total > 30000 ? Math.ceil(total / 30000) : 1;
      for (let i = 0; i < total; i += step) {
        const val = features[i]?.properties?.[field];
        if (val !== undefined && val !== null && val !== "") {
          const s = String(val);
          counts.set(s, (counts.get(s) || 0) + 1);
        }
      }

      // Select top 8 categories by frequency
      const uniqueValues = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k]) => k);

      const mapping: Record<string, { fillColor: RGBAColor; label: string }> = {};
      if (uniqueValues.length > 0) {
        uniqueValues.forEach((val: string, idx: number) => {
          const c = palette[idx % palette.length];
          mapping[val] = {
            fillColor: [c[0], c[1], c[2], currentAlpha],
            label: val,
          };
        });
      } else {
        mapping["Default"] = {
          fillColor: [palette[0][0], palette[0][1], palette[0][2], currentAlpha],
          label: "Default",
        };
      }

      const updated: CategoryStyle = {
        type: "category",
        field,
        mapping,
      };
      setMapFeatureLayerStyle(layerIndex, updated);
    },
    [features, numericFieldsSet, currentAlpha, layerIndex, setMapFeatureLayerStyle]
  );

  // Build gradient style from a field (O(n) single pass, no Math.min(...nums) stack overflows)
  const applyGradientStyleForField = useCallback(
    (field: string, minC: RGBAColor = [59, 130, 246, 180], maxC: RGBAColor = [239, 68, 68, 180]) => {
      let minVal = Infinity;
      let maxVal = -Infinity;
      let hasNum = false;

      const total = features.length;
      for (let i = 0; i < total; i++) {
        const raw = features[i]?.properties?.[field];
        if (raw !== undefined && raw !== null && raw !== "") {
          const n = Number(raw);
          if (!isNaN(n)) {
            hasNum = true;
            if (n < minVal) minVal = n;
            if (n > maxVal) maxVal = n;
          }
        }
      }

      if (!hasNum || minVal === Infinity) {
        minVal = 0;
        maxVal = 100;
      } else if (minVal === maxVal) {
        maxVal = minVal + 100;
      }

      const updated: GradientStyle = {
        type: "gradient",
        field,
        min: minVal,
        max: maxVal,
        minColor: [minC[0], minC[1], minC[2], currentAlpha],
        maxColor: [maxC[0], maxC[1], maxC[2], currentAlpha],
      };
      setMapFeatureLayerStyle(layerIndex, updated);
    },
    [features, currentAlpha, layerIndex, setMapFeatureLayerStyle]
  );

  // Switch mode tab
  const handleModeSwitch = (mode: "category" | "gradient" | "solid") => {
    if (mode === "category") {
      if (currentStyle?.type === "category") return;
      applyCategoryStyleForField(activeField);
    } else if (mode === "gradient") {
      if (currentStyle?.type === "gradient") return;
      // Find best numeric field if activeField is not numeric
      const targetField = numericFieldsSet.has(activeField)
        ? activeField
        : Array.from(numericFieldsSet)[0] || activeField;
      applyGradientStyleForField(targetField);
    } else if (mode === "solid") {
      if (currentStyle?.type === "solid") return;
      setMapFeatureLayerStyle(layerIndex, {
        type: "solid",
        fillColor: [34, 197, 94, currentAlpha],
      });
    }
  };

  // Change active property field
  const handleFieldChange = (newField: string) => {
    setLocalField(newField);
    if (activeMode === "category") {
      applyCategoryStyleForField(newField);
    } else if (activeMode === "gradient") {
      applyGradientStyleForField(newField);
    }
  };

  // Apply a category palette preset
  const handleApplyCategoryPalette = (palette: RGBAColor[]) => {
    if (currentStyle?.type === "category") {
      const keys = Object.keys(currentStyle.mapping);
      const newMapping: typeof currentStyle.mapping = {};
      keys.forEach((key, idx) => {
        const c = palette[idx % palette.length];
        newMapping[key] = {
          ...currentStyle.mapping[key],
          fillColor: [c[0], c[1], c[2], currentStyle.mapping[key]?.fillColor?.[3] ?? currentAlpha],
        };
      });
      setMapFeatureLayerStyle(layerIndex, {
        ...currentStyle,
        mapping: newMapping,
      });
    } else {
      applyCategoryStyleForField(activeField, palette);
    }
  };

  // Apply a gradient preset
  const handleApplyGradientPreset = (minC: RGBAColor, maxC: RGBAColor) => {
    if (currentStyle?.type === "gradient") {
      setMapFeatureLayerStyle(layerIndex, {
        ...currentStyle,
        minColor: [minC[0], minC[1], minC[2], currentStyle.minColor[3]],
        maxColor: [maxC[0], maxC[1], maxC[2], currentStyle.maxColor[3]],
      });
    } else {
      applyGradientStyleForField(activeField, minC, maxC);
    }
  };

  // Single category color change
  const handleSingleCategoryColorChange = (key: string, hex: string) => {
    if (!currentStyle || currentStyle.type !== "category") return;
    const curAlpha = currentStyle.mapping[key]?.fillColor?.[3] ?? currentAlpha;
    setMapFeatureLayerStyle(layerIndex, {
      ...currentStyle,
      mapping: {
        ...currentStyle.mapping,
        [key]: {
          ...currentStyle.mapping[key],
          fillColor: hexToRGBA(hex, curAlpha),
        },
      },
    });
  };

  // Solid color change
  const handleSolidColorChange = (color: RGBAColor) => {
    setMapFeatureLayerStyle(layerIndex, {
      type: "solid",
      fillColor: [color[0], color[1], color[2], currentAlpha],
    });
  };

  // Opacity change slider
  const handleOpacityChange = (percent: number) => {
    const newAlpha = Math.round((percent / 100) * 255);
    if (!currentStyle) {
      setMapFeatureLayerStyle(layerIndex, {
        type: "solid",
        fillColor: [34, 197, 94, newAlpha],
      });
      return;
    }
    if (currentStyle.type === "solid") {
      setMapFeatureLayerStyle(layerIndex, {
        ...currentStyle,
        fillColor: [currentStyle.fillColor[0], currentStyle.fillColor[1], currentStyle.fillColor[2], newAlpha],
      });
    } else if (currentStyle.type === "gradient") {
      setMapFeatureLayerStyle(layerIndex, {
        ...currentStyle,
        minColor: [currentStyle.minColor[0], currentStyle.minColor[1], currentStyle.minColor[2], newAlpha],
        maxColor: [currentStyle.maxColor[0], currentStyle.maxColor[1], currentStyle.maxColor[2], newAlpha],
      });
    } else if (currentStyle.type === "category") {
      const newMapping: typeof currentStyle.mapping = {};
      for (const [k, v] of Object.entries(currentStyle.mapping)) {
        newMapping[k] = {
          ...v,
          fillColor: [v.fillColor[0], v.fillColor[1], v.fillColor[2], newAlpha],
        };
      }
      setMapFeatureLayerStyle(layerIndex, {
        ...currentStyle,
        mapping: newMapping,
      });
    }
  };

  const handleReset = () => {
    clearMapFeatureLayerStyle(layerIndex);
  };

  return (
    <div className="w-[330px] max-w-[calc(100vw-2rem)] bg-background/95 backdrop-blur-md border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-xs transition-all duration-200 font-sans select-none">
      {/* Header Bar */}
      <div className="px-3.5 py-2.5 bg-muted/40 border-b border-border/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
            <Paintbrush className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className="font-semibold text-foreground truncate max-w-[130px] text-xs"
                title={layerName || `Layer ${layerIndex + 1}`}
              >
                {layerName || `Layer ${layerIndex + 1}`}
              </span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary capitalize">
                {currentStyle ? currentStyle.type : "Unstyled"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-md transition-colors cursor-pointer"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-md transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-3.5 space-y-3 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20">
          {/* Mode Selector Tabs */}
          <div className="grid grid-cols-3 p-1 bg-muted/60 rounded-xl border border-border/50 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => handleModeSwitch("category")}
              className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeMode === "category"
                  ? "bg-card text-foreground shadow-sm font-semibold border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <Tag className="w-3 h-3" />
              <span>Category</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch("gradient")}
              className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeMode === "gradient"
                  ? "bg-card text-foreground shadow-sm font-semibold border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <Sliders className="w-3 h-3" />
              <span>Gradient</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch("solid")}
              className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeMode === "solid"
                  ? "bg-card text-foreground shadow-sm font-semibold border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <Palette className="w-3 h-3" />
              <span>Single</span>
            </button>
          </div>

          {/* Property Selector (for Category and Gradient modes) */}
          {activeMode !== "solid" && (
            <div className="flex items-center justify-between gap-2 px-1">
              <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 shrink-0">
                <Layers className="w-3 h-3 text-muted-foreground/70" />
                <span>Property</span>
              </label>
              {availableFields.length > 0 ? (
                <select
                  value={activeField}
                  onChange={(e) => handleFieldChange(e.target.value)}
                  className="flex-1 max-w-[200px] px-2.5 py-1 rounded-lg border border-border bg-card text-foreground text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary truncate cursor-pointer shadow-sm"
                >
                  {availableFields.map((f) => (
                    <option key={f} value={f}>
                      {f} {numericFieldsSet.has(f) ? "(123)" : "(ABC)"}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-muted-foreground italic">No fields found</span>
              )}
            </div>
          )}

          {/* ─── CATEGORY MODE CONTENT ─────────────────────────────────── */}
          {activeMode === "category" && (
            <div className="space-y-2.5 pt-0.5">
              {/* Quick Themes Row */}
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">
                  Color Themes
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {CATEGORY_PALETTES.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleApplyCategoryPalette(p.colors)}
                      className="flex items-center justify-center p-1.5 rounded-lg border border-border/70 bg-card hover:bg-muted/80 transition-all hover:scale-105 cursor-pointer shadow-sm group"
                      title={p.name}
                    >
                      <div className="flex -space-x-1">
                        {p.colors.slice(0, 3).map((c, ci) => (
                          <div
                            key={ci}
                            className="w-3.5 h-3.5 rounded-full border border-background shadow-xs shrink-0"
                            style={{ backgroundColor: rgbaToCss(c) }}
                          />
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Class Mappings List */}
              <div className="space-y-1 pt-1">
                <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1 flex items-center justify-between">
                  <span>Classes & Colors</span>
                  {currentStyle?.type === "category" && currentStyle.ranges && (
                    <span className="text-[9px] text-primary lowercase font-medium">range-based</span>
                  )}
                </div>

                <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5 scrollbar-thin scrollbar-thumb-muted-foreground/20">
                  {currentStyle && currentStyle.type === "category" ? (
                    Object.entries(currentStyle.mapping).map(([key, entry]) => {
                      const range = currentStyle.ranges?.find((r) => r.category === key);
                      const badgeText = range ? formatRangeBadge(range.min, range.max) : "";

                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-card/80 border border-border/50 hover:border-border transition-colors shadow-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {/* Single Clean Interactive Swatch Button */}
                            <label
                              className="relative flex items-center justify-center w-5 h-5 rounded-full border border-white/20 shadow-sm cursor-pointer overflow-hidden shrink-0 hover:scale-110 transition-transform"
                              style={{ backgroundColor: rgbaToCss(entry.fillColor) }}
                              title={`Click to change color for ${entry.label || key}`}
                            >
                              <input
                                type="color"
                                value={rgbaToHex(entry.fillColor)}
                                onChange={(e) => handleSingleCategoryColorChange(key, e.target.value)}
                                className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                              />
                            </label>

                            <span className="font-medium text-foreground text-xs truncate">
                              {entry.label || key}
                            </span>
                          </div>

                          {badgeText && (
                            <span className="text-[10px] font-mono text-muted-foreground bg-muted/70 px-1.5 py-0.5 rounded border border-border/40 shrink-0">
                              {badgeText}
                            </span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-4 text-muted-foreground text-[11px]">
                      Click a color theme above or choose a property to generate categories.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ─── GRADIENT MODE CONTENT ─────────────────────────────────── */}
          {activeMode === "gradient" && currentStyle && currentStyle.type === "gradient" && (
            <div className="space-y-3 pt-0.5">
              {/* Presets */}
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">
                  Gradient Presets
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {GRADIENT_PRESETS.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleApplyGradientPreset(p.minColor, p.maxColor)}
                      className="p-1.5 rounded-lg border border-border/70 bg-card hover:bg-muted/80 transition-all cursor-pointer shadow-sm text-left flex flex-col gap-1"
                    >
                      <div
                        className="h-2.5 w-full rounded-md shadow-inner"
                        style={{
                          background: `linear-gradient(to right, ${rgbaToCss(p.minColor)}, ${rgbaToCss(p.maxColor)})`,
                        }}
                      />
                      <span className="text-[10px] text-muted-foreground font-medium truncate">
                        {p.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Gradient Ramp & Controls */}
              <div className="p-2.5 rounded-xl bg-card/80 border border-border/50 space-y-2">
                <div
                  className="h-4 w-full rounded-lg border border-border/60 shadow-inner"
                  style={{
                    background: `linear-gradient(to right, ${rgbaToCss(currentStyle.minColor)}, ${rgbaToCss(currentStyle.maxColor)})`,
                  }}
                />

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  {/* Min Color Swatch */}
                  <div className="flex items-center gap-1.5">
                    <label
                      className="relative flex items-center justify-center w-5 h-5 rounded-full border border-white/20 shadow-sm cursor-pointer overflow-hidden shrink-0 hover:scale-110 transition-transform"
                      style={{ backgroundColor: rgbaToCss(currentStyle.minColor) }}
                      title="Min color"
                    >
                      <input
                        type="color"
                        value={rgbaToHex(currentStyle.minColor)}
                        onChange={(e) => {
                          setMapFeatureLayerStyle(layerIndex, {
                            ...currentStyle,
                            minColor: hexToRGBA(e.target.value, currentStyle.minColor[3]),
                          });
                        }}
                        className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                      />
                    </label>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Min: {currentStyle.min.toLocaleString()}
                    </span>
                  </div>

                  {/* Max Color Swatch */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Max: {currentStyle.max.toLocaleString()}
                    </span>
                    <label
                      className="relative flex items-center justify-center w-5 h-5 rounded-full border border-white/20 shadow-sm cursor-pointer overflow-hidden shrink-0 hover:scale-110 transition-transform"
                      style={{ backgroundColor: rgbaToCss(currentStyle.maxColor) }}
                      title="Max color"
                    >
                      <input
                        type="color"
                        value={rgbaToHex(currentStyle.maxColor)}
                        onChange={(e) => {
                          setMapFeatureLayerStyle(layerIndex, {
                            ...currentStyle,
                            maxColor: hexToRGBA(e.target.value, currentStyle.maxColor[3]),
                          });
                        }}
                        className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── SOLID MODE CONTENT ───────────────────────────────────── */}
          {activeMode === "solid" && (
            <div className="space-y-3 pt-0.5">
              <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">
                Preset Palette
              </div>
              <div className="grid grid-cols-4 gap-2">
                {SOLID_PRESETS.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSolidColorChange(item.color)}
                    className="flex flex-col items-center gap-1 p-2 rounded-xl border border-border/70 bg-card hover:bg-muted/80 transition-all hover:scale-105 cursor-pointer shadow-sm"
                  >
                    <div
                      className="w-6 h-6 rounded-full border border-white/20 shadow-sm"
                      style={{ backgroundColor: item.hex }}
                    />
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {item.name}
                    </span>
                  </button>
                ))}
              </div>

              {/* Custom Hex / Color Picker */}
              <div className="flex items-center justify-between p-2 rounded-xl bg-card border border-border/50">
                <span className="text-xs font-medium text-foreground">Custom Color</span>
                <label
                  className="relative flex items-center justify-center w-7 h-7 rounded-full border border-white/20 shadow-sm cursor-pointer overflow-hidden shrink-0 hover:scale-110 transition-transform"
                  style={{
                    backgroundColor:
                      currentStyle?.type === "solid"
                        ? rgbaToCss(currentStyle.fillColor)
                        : "#22c55e",
                  }}
                  title="Pick custom color"
                >
                  <input
                    type="color"
                    value={
                      currentStyle?.type === "solid"
                        ? rgbaToHex(currentStyle.fillColor)
                        : "#22c55e"
                    }
                    onChange={(e) =>
                      handleSolidColorChange(hexToRGBA(e.target.value, currentAlpha))
                    }
                    className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                  />
                </label>
              </div>
            </div>
          )}

          {/* ─── GLOBAL OPACITY SLIDER ──────────────────────────────────── */}
          <div className="pt-2 border-t border-border/40 space-y-1.5 px-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <SlidersHorizontal className="w-3 h-3 text-muted-foreground/70" />
                <span>Layer Opacity</span>
              </span>
              <span className="font-mono text-foreground font-medium text-[10px]">
                {currentOpacity}%
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={currentOpacity}
              onChange={(e) => handleOpacityChange(Number(e.target.value))}
              className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>

          {/* ─── ACTION FOOTER ─────────────────────────────────────────── */}
          <div className="pt-2 border-t border-border/40 flex items-center justify-between px-1">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer"
              title="Reset styling to default"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>

            <div className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
              <Check className="w-3 h-3" />
              <span>Live on Map</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
