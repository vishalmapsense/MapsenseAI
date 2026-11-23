"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Layers,
  Search,
  X,
  ChevronRight,
  GraduationCap,
  HeartPulse,
  ShoppingCart,
  Utensils,
  Landmark,
  Bus,
  Trees,
  ShieldCheck,
  Home,
  Store,
  Zap,
  Sliders,
  MapPin,
  Maximize2,
  Minimize2,
  RotateCcw,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  Info,
  TrendingUp,
  Compass,
  ArrowRightLeft,
} from "lucide-react";
import { useLocusScoreStore } from "@/stores/useLocusScoreStore";
import {
  AMENITY_CATEGORIES,
  ALL_CATEGORY_IDS,
  SECTOR_PROFILES,
  BENCHMARK_PIN_CODES,
} from "@/services/locusScoreService";
import type { AmenityCategoryId, SectorProfileId } from "@/types/locusScore.types";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<AmenityCategoryId, React.ElementType> = {
  education: GraduationCap,
  healthcare: HeartPulse,
  daily_needs: ShoppingCart,
  food_beverage: Utensils,
  banking_finance: Landmark,
  transit_connectivity: Bus,
  recreation_open_space: Trees,
  civic_community: ShieldCheck,
};

const PRESET_COMPARISONS = [
  {
    name: "Bengaluru Benchmark",
    subtitle: "CBD Core vs IT Growth Corridor",
    pinA: "560001",
    labelA: "560001 (MG Road / CBD)",
    pinB: "560103",
    labelB: "560103 (Sarjapur Road)",
    isDefault: true,
  },
  {
    name: "Delhi NCR Contrast",
    subtitle: "Radial Commercial Core vs High-Density Student Hub",
    pinA: "110001",
    labelA: "110001 (Connaught Place)",
    pinB: "110092",
    labelB: "110092 (Laxmi Nagar)",
  },
  {
    name: "Mumbai Metros",
    subtitle: "Historic Financial Hub vs Prime Lifestyle Suburb",
    pinA: "400001",
    labelA: "400001 (Fort / South Mumbai)",
    pinB: "400050",
    labelB: "400050 (Bandra West)",
  },
  {
    name: "Hyderabad Cyberabad",
    subtitle: "Global Tech Corridor vs Historic Core",
    pinA: "500081",
    labelA: "500081 (HITEC City)",
    pinB: "560001",
    labelB: "560001 (Bengaluru MG Road)",
  },
];

export const LocusScoreModal = () => {
  const {
    isModalOpen,
    setModalOpen,
    pinCodeA,
    pinCodeB,
    dataPinA,
    dataPinB,
    activeSector,
    setActiveSector,
    d0,
    setD0,
    activeTab,
    setActiveTab,
    activeLayers,
    bufferLayers,
    isLoading,
    comparisonResult,
    setPinA,
    setPinB,
    loadPreset,
    toggleCategoryLayerOnMap,
    toggleAllLayersOnMap,
    toggleBufferOnMap,
    flyToPin,
    clearAllLocusLayersFromMap,
  } = useLocusScoreStore();

  const [inputA, setInputA] = useState(pinCodeA);
  const [inputB, setInputB] = useState(pinCodeB);
  const [isMinimized, setIsMinimized] = useState(false);
  const [poiCategoryFilter, setPoiCategoryFilter] = useState<AmenityCategoryId | "all">("all");
  const [selectedPinForPois, setSelectedPinForPois] = useState<"A" | "B">("A");

  if (!isModalOpen) return null;

  const activeSectorConfig = SECTOR_PROFILES[activeSector];
  const activePinForPois = selectedPinForPois === "A" ? dataPinA : dataPinB;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputA && inputA !== pinCodeA) setPinA(inputA);
    if (inputB && inputB !== pinCodeB) setPinB(inputB);
  };

  const activeLayerCountA = ALL_CATEGORY_IDS.filter(
    (c) => activeLayers[`${pinCodeA}_${c}`]
  ).length;
  const activeLayerCountB = ALL_CATEGORY_IDS.filter(
    (c) => activeLayers[`${pinCodeB}_${c}`]
  ).length;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center p-3 md:p-6 bg-black/40 backdrop-blur-[2px]">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "pointer-events-auto bg-background/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300",
          isMinimized
            ? "w-[94vw] md:w-[760px] h-[78vh] bottom-4"
            : "w-[96vw] max-w-6xl h-[92vh] max-h-[900px]"
        )}
      >
        {/* ── Top Header & Branding ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/70 bg-gradient-to-r from-primary/5 via-background to-secondary/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-md shadow-indigo-500/20 text-white font-bold text-sm">
              <Compass className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-foreground">
                  LocusScore™
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                  AI Location Intelligence
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground hidden sm:block">
                Neighborhood Scoring & Dual PIN Code Comparison for Every Indian PIN Code
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              title={isMinimized ? "Expand view" : "Compact view"}
            >
              {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setModalOpen(false)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              title="Close modal (layers remain on map)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Subheader Controls: Sector Switcher & PIN Presets ── */}
        <div className="px-5 py-3 border-b border-border/50 bg-muted/20 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Sector Profile Switcher */}
          <div className="flex items-center gap-1.5 bg-background/80 p-1 rounded-xl border border-border shadow-xs">
            <span className="text-[11px] font-semibold text-muted-foreground px-2 uppercase tracking-wider">
              Profile:
            </span>
            {(["real_estate", "fmcg_retail", "quick_commerce"] as SectorProfileId[]).map((secId) => {
              const cfg = SECTOR_PROFILES[secId];
              const isSelected = activeSector === secId;
              const Icon = secId === "real_estate" ? Home : secId === "fmcg_retail" ? Store : Zap;
              return (
                <button
                  key={secId}
                  onClick={() => setActiveSector(secId)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20 scale-[1.02]"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{cfg.name}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 bg-background/80 p-1 rounded-xl border border-border text-xs">
            <button
              onClick={() => setActiveTab("comparison")}
              className={cn(
                "px-3 py-1 rounded-lg font-medium transition-all cursor-pointer",
                activeTab === "comparison"
                  ? "bg-muted text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Comparison
            </button>
            <button
              onClick={() => setActiveTab("algorithm")}
              className={cn(
                "px-3 py-1 rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1",
                activeTab === "algorithm"
                  ? "bg-muted text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span>Algorithm & Methodology</span>
              <span className="text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1 rounded font-bold">5-Step</span>
            </button>
            <button
              onClick={() => setActiveTab("pois")}
              className={cn(
                "px-3 py-1 rounded-lg font-medium transition-all cursor-pointer",
                activeTab === "pois"
                  ? "bg-muted text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              POIs & Weights
            </button>
          </div>
        </div>

        {/* ── PIN Code Selection Bar ── */}
        <div className="px-5 py-2.5 border-b border-border/40 bg-muted/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 flex-1 max-w-xl">
            <div className="relative flex-1">
              <MapPin className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-indigo-500" />
              <input
                type="text"
                value={inputA}
                onChange={(e) => setInputA(e.target.value)}
                placeholder="PIN Code A (e.g. 560001)"
                className="w-full bg-background border border-border text-xs pl-8 pr-3 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-foreground font-medium"
              />
            </div>
            <ArrowRightLeft className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="relative flex-1">
              <MapPin className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-500" />
              <input
                type="text"
                value={inputB}
                onChange={(e) => setInputB(e.target.value)}
                placeholder="PIN Code B (e.g. 560103)"
                className="w-full bg-background border border-border text-xs pl-8 pr-3 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 text-foreground font-medium"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1 shadow-xs"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Compare</span>
            </button>
          </form>

          {/* Quick Preset Buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
            <span className="text-[10px] text-muted-foreground uppercase font-bold shrink-0">
              Presets:
            </span>
            {PRESET_COMPARISONS.map((p) => {
              const isActive = pinCodeA === p.pinA && pinCodeB === p.pinB;
              return (
                <button
                  key={p.name}
                  onClick={() => {
                    setInputA(p.pinA);
                    setInputB(p.pinB);
                    loadPreset(p.pinA, p.pinB);
                  }}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 cursor-pointer border",
                    isActive
                      ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-semibold"
                      : "bg-background border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  title={p.subtitle}
                >
                  {p.pinA} vs {p.pinB}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Main Tab Contents ── */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin scrollbar-thumb-muted-foreground/20">
          {/* TAB 1: Comparison View */}
          {activeTab === "comparison" && (
            <div className="space-y-6">
              {/* Dual Hero Scorecards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Card PIN A */}
                <div className="relative p-5 rounded-2xl bg-gradient-to-br from-indigo-500/5 via-background to-background border border-indigo-500/30 shadow-sm overflow-hidden flex flex-col justify-between">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-black text-indigo-600 dark:text-indigo-400 tracking-tight">
                          {dataPinA.pinCode}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                          {dataPinA.city}
                        </span>
                      </div>
                      <span className="text-xs font-medium text-muted-foreground italic">
                        "{dataPinA.narrativeHook}"
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-foreground mb-1">{dataPinA.name}</h3>
                    <p className="text-xs text-muted-foreground mb-4">{dataPinA.character}</p>

                    {/* Overall Score Display */}
                    <div className="flex items-center gap-4 my-3 p-3 rounded-xl bg-background/80 border border-border/60 shadow-xs">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-500 flex flex-col items-center justify-center text-white font-black shadow-lg shadow-indigo-500/25">
                        <span className="text-2xl leading-none">
                          {comparisonResult.overallDelta.scoreA}
                        </span>
                        <span className="text-[9px] uppercase tracking-wider font-semibold opacity-80">
                          / 100
                        </span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground">
                            {activeSectorConfig.name} LocusScore
                          </span>
                          {comparisonResult.overallDelta.winner === "A" && (
                            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                              +{comparisonResult.overallDelta.diff} Lead
                            </span>
                          )}
                        </div>
                        <div className="w-full bg-muted rounded-full h-2.5 mt-1.5 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full rounded-full transition-all duration-700"
                            style={{ width: `${comparisonResult.overallDelta.scoreA}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {activeSectorConfig.subtitle}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Map Controls for PIN A */}
                  <div className="flex items-center justify-between pt-3 border-t border-border/50 mt-2 gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => flyToPin(dataPinA.pinCode)}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>Fly to Area</span>
                      </button>
                      <button
                        onClick={() => toggleBufferOnMap(dataPinA.pinCode)}
                        className={cn(
                          "px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 cursor-pointer border",
                          bufferLayers[dataPinA.pinCode]
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-background border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>1 km Buffer</span>
                      </button>
                    </div>

                    <button
                      onClick={() =>
                        toggleAllLayersOnMap(
                          dataPinA.pinCode,
                          activeLayerCountA < ALL_CATEGORY_IDS.length
                        )
                      }
                      className="px-3 py-1 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-1 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>
                        {activeLayerCountA === ALL_CATEGORY_IDS.length
                          ? "Hide 8 Layers"
                          : `Show All 8 Layers (${activeLayerCountA}/8)`}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Card PIN B */}
                <div className="relative p-5 rounded-2xl bg-gradient-to-br from-purple-500/5 via-background to-background border border-purple-500/30 shadow-sm overflow-hidden flex flex-col justify-between">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-black text-purple-600 dark:text-purple-400 tracking-tight">
                          {dataPinB.pinCode}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                          {dataPinB.city}
                        </span>
                      </div>
                      <span className="text-xs font-medium text-muted-foreground italic">
                        "{dataPinB.narrativeHook}"
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-foreground mb-1">{dataPinB.name}</h3>
                    <p className="text-xs text-muted-foreground mb-4">{dataPinB.character}</p>

                    {/* Overall Score Display */}
                    <div className="flex items-center gap-4 my-3 p-3 rounded-xl bg-background/80 border border-border/60 shadow-xs">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-purple-600 to-pink-500 flex flex-col items-center justify-center text-white font-black shadow-lg shadow-purple-500/25">
                        <span className="text-2xl leading-none">
                          {comparisonResult.overallDelta.scoreB}
                        </span>
                        <span className="text-[9px] uppercase tracking-wider font-semibold opacity-80">
                          / 100
                        </span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground">
                            {activeSectorConfig.name} LocusScore
                          </span>
                          {comparisonResult.overallDelta.winner === "B" && (
                            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                              +{Math.abs(comparisonResult.overallDelta.diff)} Lead
                            </span>
                          )}
                        </div>
                        <div className="w-full bg-muted rounded-full h-2.5 mt-1.5 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-purple-500 to-pink-500 h-full rounded-full transition-all duration-700"
                            style={{ width: `${comparisonResult.overallDelta.scoreB}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {activeSectorConfig.subtitle}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Map Controls for PIN B */}
                  <div className="flex items-center justify-between pt-3 border-t border-border/50 mt-2 gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => flyToPin(dataPinB.pinCode)}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>Fly to Area</span>
                      </button>
                      <button
                        onClick={() => toggleBufferOnMap(dataPinB.pinCode)}
                        className={cn(
                          "px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 cursor-pointer border",
                          bufferLayers[dataPinB.pinCode]
                            ? "bg-purple-600 text-white border-purple-600"
                            : "bg-background border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>1 km Buffer</span>
                      </button>
                    </div>

                    <button
                      onClick={() =>
                        toggleAllLayersOnMap(
                          dataPinB.pinCode,
                          activeLayerCountB < ALL_CATEGORY_IDS.length
                        )
                      }
                      className="px-3 py-1 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-1 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>
                        {activeLayerCountB === ALL_CATEGORY_IDS.length
                          ? "Hide 8 Layers"
                          : `Show All 8 Layers (${activeLayerCountB}/8)`}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Automated AI Narrative Takeaway Callouts */}
              {comparisonResult.narrativeTakeaways.length > 0 && (
                <div className="p-4 rounded-xl bg-muted/40 border border-border/70 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Location Intelligence Takeaways</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
                    {comparisonResult.narrativeTakeaways.map((note, i) => (
                      <div key={i} className="flex items-start gap-2 bg-background/60 p-2.5 rounded-lg border border-border/40">
                        <ChevronRight className="w-3.5 h-3.5 text-indigo-500 mt-0.5 shrink-0" />
                        <span>{note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 8 Amenity Categories Detailed Comparison & Visual Layers */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    <span>8 Amenity Categories (OSM Layers & Proximity Decay)</span>
                  </h4>
                  <span className="text-[11px] text-muted-foreground">
                    Click <span className="font-semibold text-foreground">"Show Layer"</span> on any category to render live POIs on DeckGL
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {ALL_CATEGORY_IDS.map((catId) => {
                    const cfg = AMENITY_CATEGORIES[catId];
                    const delta = comparisonResult.categoryDeltas[catId];
                    const weightPct = Math.round((activeSectorConfig.weights[catId] || 0) * 100);
                    const Icon = CATEGORY_ICONS[catId];

                    const isLayerAActive = !!activeLayers[`${pinCodeA}_${catId}`];
                    const isLayerBActive = !!activeLayers[`${pinCodeB}_${catId}`];

                    return (
                      <div
                        key={catId}
                        className="p-3.5 rounded-xl bg-card border border-border hover:border-primary/40 transition-all shadow-xs flex flex-col gap-3 group"
                      >
                        {/* Header: Icon, Label, "Why it matters in India", Sector Weight */}
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 shadow-xs"
                              style={{ backgroundColor: cfg.colorHex }}
                            >
                              <Icon className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-foreground">
                                  {cfg.label}
                                </span>
                                <span
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                                  style={{ backgroundColor: cfg.colorHex }}
                                >
                                  Weight: {weightPct}%
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                <span className="italic font-medium text-foreground/80">
                                  "{cfg.whyItMatters}"
                                </span>
                                <span>•</span>
                                <span className="text-[10px] opacity-75">{cfg.osmTags.join(", ")}</span>
                              </p>
                            </div>
                          </div>

                          {/* Visual Layer Map Toggle Buttons for this category */}
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => toggleCategoryLayerOnMap(pinCodeA, catId)}
                              className={cn(
                                "px-2.5 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer border",
                                isLayerAActive
                                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs shadow-indigo-500/20"
                                  : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border-border"
                              )}
                              title={`Toggle ${cfg.label} layer for ${pinCodeA} on map`}
                            >
                              {isLayerAActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 opacity-60" />}
                              <span>{pinCodeA} Layer</span>
                            </button>

                            <button
                              onClick={() => toggleCategoryLayerOnMap(pinCodeB, catId)}
                              className={cn(
                                "px-2.5 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer border",
                                isLayerBActive
                                  ? "bg-purple-600 text-white border-purple-600 shadow-xs shadow-purple-500/20"
                                  : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border-border"
                              )}
                              title={`Toggle ${cfg.label} layer for ${pinCodeB} on map`}
                            >
                              {isLayerBActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 opacity-60" />}
                              <span>{pinCodeB} Layer</span>
                            </button>
                          </div>
                        </div>

                        {/* Comparative Score Progress Bars Side-by-Side */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                          {/* PIN A bar */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                                {pinCodeA} Score: {delta.scoreA} / 100
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {delta.poiCountA} POIs (Decayed Val: {delta.amenityValueA})
                              </span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                                style={{ width: `${delta.scoreA}%` }}
                              />
                            </div>
                          </div>

                          {/* PIN B bar */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-purple-600 dark:text-purple-400">
                                {pinCodeB} Score: {delta.scoreB} / 100
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {delta.poiCountB} POIs (Decayed Val: {delta.amenityValueB})
                              </span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-purple-500 h-full rounded-full transition-all duration-500"
                                style={{ width: `${delta.scoreB}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Scoring Algorithm & Calibration Slide ("keep this one slide, plain language") */}
          {activeTab === "algorithm" && (
            <div className="space-y-6 max-w-4xl mx-auto py-2">
              <div className="text-center space-y-2 mb-6">
                <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-3 py-1 rounded-full">
                  Executive Methodology Slide
                </span>
                <h3 className="text-xl md:text-2xl font-black text-foreground tracking-tight">
                  LocusScore Scoring Algorithm & Distance-Decay Math
                </h3>
                <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
                  Plain-language breakdown of how raw OpenStreetMap points transform into calibrated location intelligence across every Indian PIN code.
                </p>
              </div>

              {/* 5-Step Cards */}
              <div className="space-y-3.5">
                {/* Step 1 */}
                <div className="p-4 rounded-xl bg-card border border-border shadow-xs flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500 text-white font-black flex items-center justify-center shrink-0">
                    1
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-foreground">
                      Step 1 — Geocode the Amenities (PIN Boundary + 1 km Buffer)
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Pull all OSM points inside the PIN code polygon plus a <strong>1 km buffer</strong> around its boundary. Real estate and retail shoppers do not stop walking at an administrative line — amenities just outside the line still genuinely count toward neighbourhood quality.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="p-4 rounded-xl bg-card border border-border shadow-xs flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white font-black flex items-center justify-center shrink-0">
                    2
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-sm text-foreground">
                      Step 2 — Distance-Decay, Not Raw Counts
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      A hospital 200 m away should count much more than one 3 km away. Rather than treating all amenities equally, we compute proximity-decayed values:
                    </p>
                    <div className="my-2 p-3 rounded-lg bg-muted/60 font-mono text-xs text-primary font-semibold flex items-center justify-between flex-wrap gap-2">
                      <span>AmenityValue = Σ [ 1 / (1 + distance_km / d0) ]</span>
                      <span className="text-[11px] font-sans text-muted-foreground">
                        (d0 ≈ {d0} km, tunable)
                      </span>
                    </div>

                    {/* Interactive Tunable d0 Slider */}
                    <div className="mt-3 p-3 rounded-xl bg-background/80 border border-border/80 flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        <Sliders className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Interactive d0 Proximity Decay Slider:</span>
                      </div>
                      <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                        <input
                          type="range"
                          min="0.1"
                          max="2.0"
                          step="0.05"
                          value={d0}
                          onChange={(e) => setD0(parseFloat(e.target.value))}
                          className="flex-1 accent-emerald-500 cursor-pointer"
                        />
                        <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                          {d0.toFixed(2)} km
                        </span>
                      </div>
                      <button
                        onClick={() => setD0(0.5)}
                        className="text-[11px] font-semibold text-muted-foreground hover:text-foreground underline cursor-pointer"
                      >
                        Reset (0.50 km)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="p-4 rounded-xl bg-card border border-border shadow-xs flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-amber-500 text-white font-black flex items-center justify-center shrink-0">
                    3
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-foreground">
                      Step 3 — Normalize Per Category, City-Wide (0–100)
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Min-max scale each category's score against every other PIN code in the same city. This ensures "good transit connectivity" means something relative to Bengaluru standards, not relative to a rural village.
                    </p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="p-4 rounded-xl bg-card border border-border shadow-xs flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-rose-500 text-white font-black flex items-center justify-center shrink-0">
                    4
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-sm text-foreground">
                      Step 4 — Apply Sector-Specific Weights and Sum
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      LocationScore = Σ (Weight_category × NormalizedScore_category). Same physical amenities answer radically different business questions:
                    </p>

                    {/* Sector Weights Table */}
                    <div className="mt-2.5 overflow-x-auto rounded-lg border border-border/80 text-xs">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-muted/60 text-muted-foreground border-b border-border">
                            <th className="p-2">Category</th>
                            <th className="p-2">🏠 Real Estate</th>
                            <th className="p-2">🛒 FMCG / Retail</th>
                            <th className="p-2">🛵 Quick-Commerce</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {ALL_CATEGORY_IDS.map((c) => (
                            <tr key={c} className="hover:bg-muted/30">
                              <td className="p-2 font-medium text-foreground">{AMENITY_CATEGORIES[c].label}</td>
                              <td className="p-2 font-mono">{Math.round(SECTOR_PROFILES.real_estate.weights[c] * 100)}%</td>
                              <td className="p-2 font-mono">{Math.round(SECTOR_PROFILES.fmcg_retail.weights[c] * 100)}%</td>
                              <td className="p-2 font-mono">{Math.round(SECTOR_PROFILES.quick_commerce.weights[c] * 100)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Step 5 - Credibility Slide */}
                <div className="p-5 rounded-xl bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border-2 border-indigo-500/40 shadow-md flex items-start gap-4">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-pink-600 text-white font-black flex items-center justify-center shrink-0 shadow-sm">
                    5
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-black text-sm text-foreground">
                        Step 5 — Calibrate (Credibility Slide)
                      </h4>
                      <span className="text-[10px] font-bold bg-indigo-500 text-white px-2 py-0.5 rounded-full uppercase">
                        Enterprise Credibility
                      </span>
                    </div>
                    <p className="text-xs text-foreground/90 mt-1 leading-relaxed">
                      Weights start from expert judgment (AHP-style pairwise comparison matrix), then get systematically tuned against real ground-truth outcomes — <strong>actual property price/sqft</strong> for Real Estate, and <strong>store revenue/daily throughput</strong> for FMCG & retail site selection.
                    </p>
                    <div className="mt-3 p-3 rounded-lg bg-background/80 border border-indigo-500/30 text-xs italic font-medium text-indigo-700 dark:text-indigo-300">
                      💡 "Say this out loud in the demo: <span className="font-bold underline">These weights aren't arbitrary, and they get sharper as we ingest your data.</span>"
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: POIs & Proximity Directory */}
          {activeTab === "pois" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">Select PIN:</span>
                  <button
                    onClick={() => setSelectedPinForPois("A")}
                    className={cn(
                      "px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                      selectedPinForPois === "A"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {dataPinA.pinCode} ({dataPinA.name})
                  </button>
                  <button
                    onClick={() => setSelectedPinForPois("B")}
                    className={cn(
                      "px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                      selectedPinForPois === "B"
                        ? "bg-purple-600 text-white shadow-xs"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {dataPinB.pinCode} ({dataPinB.name})
                  </button>
                </div>

                {/* Category filter */}
                <select
                  value={poiCategoryFilter}
                  onChange={(e) => setPoiCategoryFilter(e.target.value as any)}
                  className="bg-background border border-border text-xs rounded-lg px-2.5 py-1 text-foreground focus:ring-1 focus:ring-primary"
                >
                  <option value="all">All 8 Categories</option>
                  {ALL_CATEGORY_IDS.map((c) => (
                    <option key={c} value={c}>
                      {AMENITY_CATEGORIES[c].label}
                    </option>
                  ))}
                </select>
              </div>

              {/* POI Table */}
              <div className="rounded-xl border border-border overflow-hidden bg-card text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-muted/70 text-muted-foreground border-b border-border">
                      <th className="p-2.5">POI Name</th>
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5">OSM Tag</th>
                      <th className="p-2.5">Distance</th>
                      <th className="p-2.5">Decayed Weight</th>
                      <th className="p-2.5">Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {activePinForPois.pois
                      .filter((p) => poiCategoryFilter === "all" || p.category === poiCategoryFilter)
                      .map((poi) => {
                        const cfg = AMENITY_CATEGORIES[poi.category];
                        return (
                          <tr key={poi.id} className="hover:bg-muted/40 transition-colors">
                            <td className="p-2.5 font-semibold text-foreground">{poi.name}</td>
                            <td className="p-2.5">
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                                style={{ backgroundColor: cfg.colorHex }}
                              >
                                {cfg.label}
                              </span>
                            </td>
                            <td className="p-2.5 font-mono text-[11px] text-muted-foreground">
                              {poi.amenityTag}
                            </td>
                            <td className="p-2.5 font-mono">{poi.distanceKm} km</td>
                            <td className="p-2.5 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {poi.decayWeight.toFixed(2)}
                            </td>
                            <td className="p-2.5 text-muted-foreground truncate max-w-[200px]">
                              {poi.address || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    {activePinForPois.pois.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-muted-foreground">
                          No live POIs cached for this PIN. Click "Show All 8 Layers" to query Overpass live.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-border/70 bg-muted/20 flex items-center justify-between text-xs text-muted-foreground shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>LocusScore Engine Active</span>
            <span>•</span>
            <span>Active Layers on DeckGL: {activeLayerCountA + activeLayerCountB}</span>
          </div>

          <div className="flex items-center gap-2">
            {(activeLayerCountA > 0 || activeLayerCountB > 0) && (
              <button
                onClick={clearAllLocusLayersFromMap}
                className="px-2.5 py-1 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 rounded-md transition-colors cursor-pointer"
              >
                Clear All Map Layers
              </button>
            )}
            <button
              onClick={() => setModalOpen(false)}
              className="px-4 py-1.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
            >
              Inspect Map
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
