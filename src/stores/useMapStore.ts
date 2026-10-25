import { create } from "zustand";
import type { VisualizationLayerType } from "@/types/mcp.types";
import type { LayerStyle } from "@/types/layerStyle.types";


export type BaseMapType = "osm" | "carto-light" | "carto-dark" | "satellite";

export interface MapCommand {
  type:
    | "CLEAR_MAP"
    | "FIT_BOUNDS"
    | "ZOOM_IN"
    | "ZOOM_OUT"
    | "SET_ZOOM"
    | "ROTATE"
    | "RESET_ROTATION"
    | "FLY_TO"
    | "SET_BASE_MAP"
    | "TOGGLE_LAYER"
    | "TOGGLE_3D"
    | "ADD_MARKER"
    | "REMOVE_MARKER"
    | "MOVE_MARKER"
    | "DRAW_POINT"
    | "DRAW_LINE"
    | "DRAW_POLYGON"
    | "DRAW_CIRCLE"
    | "DRAW_RECTANGLE"
    | "EDIT_GEOMETRY"
    | "DELETE_GEOMETRY"
    | "SIMPLIFY_GEOMETRY"
    | "BUFFER_GEOMETRY"
    | "ADD_GEOJSON"
    | "LOAD_URL"
    | "SPLIT_POLYGON"
    | "MERGE_POLYGONS"
    | "SELECT_LAYER"
    | "REQUEST_PERMISSION"
    | "RUN_CLIENT_DUCKDB_QUERY"
    | "STYLE_LAYER"
    | "CLEAR_LAYER_STYLE"
    | "COMPARE_PINCODES"
    | "SCORE_PINCODE";
  payload?: any;
}

export interface MapViewState {
  center: [number, number]; // [lng, lat]
  zoom: number;
  rotation: number;
}

export interface DeckViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  transitionDuration?: number;
  transitionInterpolator?: any;
}

export interface VisualizationLayerEntry {
  queryId: string;
  layerType: VisualizationLayerType;
  data: any[];                   // Extracted coordinate/feature data
  config?: Record<string, any>;  // Layer-specific config (radius, colorRange, etc.)
}

interface MapState {
  mapFeatures: any[]; // Array of GeoJSON Feature or FeatureCollection
  baseMap: BaseMapType;
  mapViewState: MapViewState | null; // Track current map viewport state (for LLM context)
  viewState: DeckViewState; // Actual deck.gl view state
  mapInstance: any | null; // deck.gl or maplibre instance if needed
  interactionMode: string | null; // e.g. 'draw_polygon', 'edit', 'delete', null
  selectedLayerIndex: number | null;
  hoverInfo: { props: Record<string, any>; x: number; y: number } | null;
  zoomTrigger: number; // Increment to force map zoom

  highlightedFeatureId: string | null;
  lockedHoverInfo: { props: Record<string, any>; x: number; y: number; lng?: number; lat?: number } | null;

  // Visualization layers (HexagonLayer, HeatmapLayer, etc.) — separate from GeoJSON mapFeatures
  visualizationLayers: VisualizationLayerEntry[];

  // Per-layer deck.gl visualization type overrides for mapFeatures
  // Maps layer index → VisualizationLayerType (default is GeoJsonLayer)
  mapFeatureLayerTypes: Record<number, VisualizationLayerType>;

  // Per-layer configuration overrides (radius, opacity, colors, etc.)
  mapFeatureLayerConfigs: Record<number, any>;

  // Per-layer data-driven styles (category coloring, gradient, solid)
  mapFeatureLayerStyles: Record<number, LayerStyle>;

  // Active layer index for the floating LayerStylePanel (null if closed)
  activeStylePanelLayerIndex: number | null;
  setActiveStylePanelLayerIndex: (index: number | null) => void;

  // Indices of mapFeatures that are hidden from the map
  hiddenLayerIndexes: number[];

  clearFeatures: () => void;
  triggerZoomToFit: () => void;
  setMapFeatures: (features: any[]) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  removeLayer: (index: number) => void;
  setBaseMap: (baseMap: BaseMapType) => void;
  setMapViewState: (state: MapViewState) => void;
  setViewState: (state: Partial<DeckViewState>) => void;
  setMapInstance: (map: any | null) => void;
  setInteractionMode: (mode: string | null) => void;
  setSelectedLayerIndex: (index: number | null) => void;
  setHoverInfo: (info: { props: Record<string, any>; x: number; y: number } | null) => void;
  setLockedHoverInfo: (info: { props: Record<string, any>; x: number; y: number; lng?: number; lat?: number } | null) => void;
  setHighlightedFeatureId: (id: string | null) => void;
  zoomToFeatureBoundingBox: (feature: any) => void;

  // Layer visibility actions
  toggleLayerVisibility: (layerIndex: number) => void;
  setLayerVisibility: (layerIndex: number, visible: boolean) => void;
  setHiddenLayerIndexes: (indexes: number[] | ((prev: number[]) => number[])) => void;

  // Visualization layer actions
  addVisualizationLayer: (layer: VisualizationLayerEntry) => void;
  removeVisualizationLayer: (queryId: string) => void;
  updateVisualizationLayerType: (queryId: string, layerType: VisualizationLayerType) => void;
  clearVisualizationLayers: () => void;

  // Map feature layer type override actions
  setMapFeatureLayerType: (layerIndex: number, layerType: VisualizationLayerType) => void;
  clearMapFeatureLayerType: (layerIndex: number) => void;
  setMapFeatureLayerConfig: (layerIndex: number, config: any) => void;
  resetMapFeatureLayerConfig: (layerIndex: number) => void;

  // Layer style actions
  setMapFeatureLayerStyle: (layerIndex: number, style: LayerStyle) => void;
  clearMapFeatureLayerStyle: (layerIndex: number) => void;
  clearAllLayerStyles: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  mapFeatures: [],
  baseMap: "carto-light",
  mapViewState: null,
  viewState: { longitude: 0, latitude: 0, zoom: 2, pitch: 0, bearing: 0 },
  mapInstance: null,
  interactionMode: null,
  selectedLayerIndex: null,
  hoverInfo: null,
  zoomTrigger: 0,
  highlightedFeatureId: null,
  lockedHoverInfo: null,
  visualizationLayers: [],
  mapFeatureLayerTypes: {},
  mapFeatureLayerConfigs: {},
  mapFeatureLayerStyles: {},
  activeStylePanelLayerIndex: null,
  hiddenLayerIndexes: [],

  clearFeatures: () => set({ mapFeatures: [], selectedLayerIndex: null, highlightedFeatureId: null, lockedHoverInfo: null, visualizationLayers: [], mapFeatureLayerTypes: {}, mapFeatureLayerConfigs: {}, mapFeatureLayerStyles: {}, activeStylePanelLayerIndex: null, hiddenLayerIndexes: [] }),
  triggerZoomToFit: () => set((state) => ({ zoomTrigger: state.zoomTrigger + 1 })),
  setMapFeatures: (features) =>
    set((prev) => {
      const newStyles: Record<number, LayerStyle> = {};
      const newTypes: Record<number, VisualizationLayerType> = {};
      const newConfigs: Record<number, any> = {};

      features.forEach((feat, idx) => {
        if (feat) {
          if (feat._layerStyle) {
            newStyles[idx] = feat._layerStyle;
          } else if (
            prev.mapFeatureLayerStyles[idx] &&
            (features.length === prev.mapFeatures.length || feat === prev.mapFeatures[idx])
          ) {
            newStyles[idx] = prev.mapFeatureLayerStyles[idx];
            feat._layerStyle = prev.mapFeatureLayerStyles[idx];
          }

          if (feat._layerType) {
            newTypes[idx] = feat._layerType;
          } else if (
            prev.mapFeatureLayerTypes[idx] &&
            (features.length === prev.mapFeatures.length || feat === prev.mapFeatures[idx])
          ) {
            newTypes[idx] = prev.mapFeatureLayerTypes[idx];
            feat._layerType = prev.mapFeatureLayerTypes[idx];
          }

          if (feat._layerConfig) {
            newConfigs[idx] = feat._layerConfig;
          } else if (
            prev.mapFeatureLayerConfigs[idx] &&
            (features.length === prev.mapFeatures.length || feat === prev.mapFeatures[idx])
          ) {
            newConfigs[idx] = prev.mapFeatureLayerConfigs[idx];
            feat._layerConfig = prev.mapFeatureLayerConfigs[idx];
          }

          if (!feat._layerId) {
            feat._layerId = `layer-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
          }
        }
      });

      return {
        mapFeatures: features,
        mapFeatureLayerStyles: newStyles,
        mapFeatureLayerTypes: newTypes,
        mapFeatureLayerConfigs: newConfigs,
        selectedLayerIndex:
          prev.selectedLayerIndex !== null && prev.selectedLayerIndex >= features.length
            ? null
            : prev.selectedLayerIndex,
        hiddenLayerIndexes: prev.hiddenLayerIndexes.filter((idx) => idx < features.length),
      };
    }),

  reorderLayers: (fromIndex, toIndex) =>
    set((state) => {
      if (
        fromIndex < 0 ||
        fromIndex >= state.mapFeatures.length ||
        toIndex < 0 ||
        toIndex >= state.mapFeatures.length ||
        fromIndex === toIndex
      ) {
        return state;
      }

      const updatedFeatures = [...state.mapFeatures];
      const [draggedItem] = updatedFeatures.splice(fromIndex, 1);
      updatedFeatures.splice(toIndex, 0, draggedItem);

      const remap = (idx: number) => {
        if (idx === fromIndex) return toIndex;
        if (fromIndex < toIndex && idx > fromIndex && idx <= toIndex) return idx - 1;
        if (fromIndex > toIndex && idx >= toIndex && idx < fromIndex) return idx + 1;
        return idx;
      };

      const newStyles: Record<number, LayerStyle> = {};
      const newTypes: Record<number, VisualizationLayerType> = {};
      const newConfigs: Record<number, any> = {};

      // Migrate existing records by index
      Object.entries(state.mapFeatureLayerStyles).forEach(([idxStr, style]) => {
        newStyles[remap(Number(idxStr))] = style;
      });
      Object.entries(state.mapFeatureLayerTypes).forEach(([idxStr, type]) => {
        newTypes[remap(Number(idxStr))] = type;
      });
      Object.entries(state.mapFeatureLayerConfigs).forEach(([idxStr, config]) => {
        newConfigs[remap(Number(idxStr))] = config;
      });

      // Synchronize with properties directly on the features (source of truth)
      updatedFeatures.forEach((feat, idx) => {
        if (feat) {
          if (feat._layerStyle) {
            newStyles[idx] = feat._layerStyle;
          } else if (newStyles[idx]) {
            feat._layerStyle = newStyles[idx];
          }

          if (feat._layerType) {
            newTypes[idx] = feat._layerType;
          } else if (newTypes[idx]) {
            feat._layerType = newTypes[idx];
          }

          if (feat._layerConfig) {
            newConfigs[idx] = feat._layerConfig;
          } else if (newConfigs[idx]) {
            feat._layerConfig = newConfigs[idx];
          }
        }
      });

      let newSelected = state.selectedLayerIndex;
      if (newSelected !== null) {
        newSelected = remap(newSelected);
      }

      let newActiveStyle = state.activeStylePanelLayerIndex;
      if (newActiveStyle !== null) {
        newActiveStyle = remap(newActiveStyle);
      }

      const newHidden = state.hiddenLayerIndexes.map(remap);

      return {
        mapFeatures: updatedFeatures,
        mapFeatureLayerStyles: newStyles,
        mapFeatureLayerTypes: newTypes,
        mapFeatureLayerConfigs: newConfigs,
        selectedLayerIndex: newSelected,
        activeStylePanelLayerIndex: newActiveStyle,
        hiddenLayerIndexes: newHidden,
      };
    }),

  removeLayer: (index) =>
    set((state) => {
      if (index < 0 || index >= state.mapFeatures.length) return state;

      const updatedFeatures = [...state.mapFeatures];
      updatedFeatures.splice(index, 1);

      const newStyles: Record<number, LayerStyle> = {};
      const newTypes: Record<number, VisualizationLayerType> = {};
      const newConfigs: Record<number, any> = {};

      Object.entries(state.mapFeatureLayerStyles).forEach(([idxStr, style]) => {
        const i = Number(idxStr);
        if (i < index) newStyles[i] = style;
        else if (i > index) newStyles[i - 1] = style;
      });

      Object.entries(state.mapFeatureLayerTypes).forEach(([idxStr, type]) => {
        const i = Number(idxStr);
        if (i < index) newTypes[i] = type;
        else if (i > index) newTypes[i - 1] = type;
      });

      Object.entries(state.mapFeatureLayerConfigs).forEach(([idxStr, config]) => {
        const i = Number(idxStr);
        if (i < index) newConfigs[i] = config;
        else if (i > index) newConfigs[i - 1] = config;
      });

      let newSelected = state.selectedLayerIndex;
      if (newSelected === index) newSelected = null;
      else if (newSelected !== null && newSelected > index) newSelected = newSelected - 1;

      let newActiveStyle = state.activeStylePanelLayerIndex;
      if (newActiveStyle === index) newActiveStyle = null;
      else if (newActiveStyle !== null && newActiveStyle > index) newActiveStyle = newActiveStyle - 1;

      const newHidden = state.hiddenLayerIndexes
        .filter((i) => i !== index)
        .map((i) => (i > index ? i - 1 : i));

      return {
        mapFeatures: updatedFeatures,
        mapFeatureLayerStyles: newStyles,
        mapFeatureLayerTypes: newTypes,
        mapFeatureLayerConfigs: newConfigs,
        selectedLayerIndex: newSelected,
        activeStylePanelLayerIndex: newActiveStyle,
        hiddenLayerIndexes: newHidden,
      };
    }),
  setBaseMap: (baseMap) => set({ baseMap }),
  setMapViewState: (mapViewState) => set({ mapViewState }),
  setViewState: (state) =>
    set((prev) => {
      const viewState = { ...prev.viewState, ...state };
      if (!("transitionDuration" in state)) {
        delete viewState.transitionDuration;
      }
      if (!("transitionInterpolator" in state)) {
        delete viewState.transitionInterpolator;
      }
      
      // Enforce hard limit on max zoom to 19 to prevent OpenStreetMap 404s
      if (viewState.zoom > 19) {
        viewState.zoom = 19;
      }

      return {
        viewState,
        mapViewState: {
          center: [viewState.longitude, viewState.latitude],
          zoom: viewState.zoom,
          rotation: viewState.bearing,
        },
      };
    }),
  setMapInstance: (mapInstance) => set({ mapInstance }),
  setInteractionMode: (interactionMode) => set({ interactionMode }),
  setSelectedLayerIndex: (selectedLayerIndex) => set({ selectedLayerIndex }),
  setHoverInfo: (hoverInfo) => set({ hoverInfo }),
  setLockedHoverInfo: (lockedHoverInfo) => set({ lockedHoverInfo }),
  setHighlightedFeatureId: (id) => set({ highlightedFeatureId: id }),
  zoomToFeatureBoundingBox: async (feature) => {
    try {
      const turf = await import('@turf/turf');
      const box = turf.bbox(feature);
      const [minLng, minLat, maxLng, maxLat] = box;
      
      const { WebMercatorViewport } = await import('@deck.gl/core');
      const viewport = new WebMercatorViewport({
        width: window.innerWidth || 800,
        height: window.innerHeight || 600
      });
      const fitted = viewport.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 40 }
      );
      
      set((prev) => ({
        viewState: {
          ...prev.viewState,
          longitude: fitted.longitude,
          latitude: fitted.latitude,
          zoom: Math.min(fitted.zoom, 18),
          transitionDuration: 1000,
        }
      }));
    } catch (e) {
      console.error("Failed to zoom to feature", e);
    }
  },

  // ─── Visualization Layer Actions ─────────────────────────────
  addVisualizationLayer: (layer) => set((state) => {
    // Replace existing layer for same queryId (prevents duplicates on re-click)
    const filtered = state.visualizationLayers.filter(vl => vl.queryId !== layer.queryId);
    return { visualizationLayers: [...filtered, layer] };
  }),

  removeVisualizationLayer: (queryId) => set((state) => ({
    visualizationLayers: state.visualizationLayers.filter(vl => vl.queryId !== queryId),
  })),

  updateVisualizationLayerType: (queryId, layerType) => set((state) => ({
    visualizationLayers: state.visualizationLayers.map(vl =>
      vl.queryId === queryId ? { ...vl, layerType } : vl
    ),
  })),

  clearVisualizationLayers: () => set({ visualizationLayers: [] }),

  // ─── Map Feature Layer Type Override Actions ──────────────────
  setMapFeatureLayerType: (layerIndex, layerType) =>
    set((state) => {
      const updatedFeatures = [...state.mapFeatures];
      if (updatedFeatures[layerIndex]) {
        updatedFeatures[layerIndex] = {
          ...updatedFeatures[layerIndex],
          _layerType: layerType,
        };
      }
      return {
        mapFeatures: updatedFeatures,
        mapFeatureLayerTypes: { ...state.mapFeatureLayerTypes, [layerIndex]: layerType },
      };
    }),
  clearMapFeatureLayerType: (layerIndex) =>
    set((state) => {
      const updatedTypes = { ...state.mapFeatureLayerTypes };
      const updatedConfigs = { ...state.mapFeatureLayerConfigs };
      delete updatedTypes[layerIndex];
      delete updatedConfigs[layerIndex];
      const updatedFeatures = [...state.mapFeatures];
      if (updatedFeatures[layerIndex]) {
        const copy = { ...updatedFeatures[layerIndex] };
        delete copy._layerType;
        delete copy._layerConfig;
        updatedFeatures[layerIndex] = copy;
      }
      return { 
        mapFeatures: updatedFeatures,
        mapFeatureLayerTypes: updatedTypes,
        mapFeatureLayerConfigs: updatedConfigs 
      };
    }),
  setMapFeatureLayerConfig: (layerIndex, config) =>
    set((state) => {
      const mergedConfig = {
        ...(state.mapFeatureLayerConfigs[layerIndex] || {}),
        ...config,
      };
      const updatedFeatures = [...state.mapFeatures];
      if (updatedFeatures[layerIndex]) {
        updatedFeatures[layerIndex] = {
          ...updatedFeatures[layerIndex],
          _layerConfig: mergedConfig,
        };
      }
      return {
        mapFeatures: updatedFeatures,
        mapFeatureLayerConfigs: {
          ...state.mapFeatureLayerConfigs,
          [layerIndex]: mergedConfig,
        },
      };
    }),
  resetMapFeatureLayerConfig: (layerIndex) =>
    set((state) => {
      const updatedConfigs = { ...state.mapFeatureLayerConfigs };
      delete updatedConfigs[layerIndex];
      const updatedFeatures = [...state.mapFeatures];
      if (updatedFeatures[layerIndex]) {
        const copy = { ...updatedFeatures[layerIndex] };
        delete copy._layerConfig;
        updatedFeatures[layerIndex] = copy;
      }
      return {
        mapFeatures: updatedFeatures,
        mapFeatureLayerConfigs: updatedConfigs,
      };
    }),

  // ─── Layer Style Actions ─────────────────────────────────────
  setMapFeatureLayerStyle: (layerIndex, style) =>
    set((state) => {
      const updatedFeatures = [...state.mapFeatures];
      if (updatedFeatures[layerIndex]) {
        updatedFeatures[layerIndex] = {
          ...updatedFeatures[layerIndex],
          _layerStyle: style,
        };
      }
      return {
        mapFeatures: updatedFeatures,
        mapFeatureLayerStyles: { ...state.mapFeatureLayerStyles, [layerIndex]: style },
      };
    }),
  clearMapFeatureLayerStyle: (layerIndex) =>
    set((state) => {
      const updated = { ...state.mapFeatureLayerStyles };
      delete updated[layerIndex];
      const updatedFeatures = [...state.mapFeatures];
      if (updatedFeatures[layerIndex]) {
        const copy = { ...updatedFeatures[layerIndex] };
        delete copy._layerStyle;
        updatedFeatures[layerIndex] = copy;
      }
      return {
        mapFeatures: updatedFeatures,
        mapFeatureLayerStyles: updated,
        activeStylePanelLayerIndex:
          state.activeStylePanelLayerIndex === layerIndex ? null : state.activeStylePanelLayerIndex,
      };
    }),
  clearAllLayerStyles: () =>
    set((state) => {
      const updatedFeatures = state.mapFeatures.map((feat) => {
        if (!feat || !feat._layerStyle) return feat;
        const copy = { ...feat };
        delete copy._layerStyle;
        return copy;
      });
      return {
        mapFeatures: updatedFeatures,
        mapFeatureLayerStyles: {},
        activeStylePanelLayerIndex: null,
      };
    }),
  setActiveStylePanelLayerIndex: (index) => set({ activeStylePanelLayerIndex: index }),

  // ─── Layer Visibility Actions ────────────────────────────────
  toggleLayerVisibility: (layerIndex) =>
    set((state) => {
      const isHidden = state.hiddenLayerIndexes.includes(layerIndex);
      return {
        hiddenLayerIndexes: isHidden
          ? state.hiddenLayerIndexes.filter((i) => i !== layerIndex)
          : [...state.hiddenLayerIndexes, layerIndex],
      };
    }),
  setLayerVisibility: (layerIndex, visible) =>
    set((state) => {
      const isHidden = state.hiddenLayerIndexes.includes(layerIndex);
      if (visible && isHidden) {
        return { hiddenLayerIndexes: state.hiddenLayerIndexes.filter((i) => i !== layerIndex) };
      }
      if (!visible && !isHidden) {
        return { hiddenLayerIndexes: [...state.hiddenLayerIndexes, layerIndex] };
      }
      return state;
    }),
  setHiddenLayerIndexes: (indexes) =>
    set((state) => ({
      hiddenLayerIndexes:
        typeof indexes === "function" ? indexes(state.hiddenLayerIndexes) : indexes,
    })),
}));
