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
    | "CLEAR_LAYER_STYLE";
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
    set((prev) => ({
      mapFeatures: features,
      selectedLayerIndex:
        prev.selectedLayerIndex !== null && prev.selectedLayerIndex >= features.length
          ? null
          : prev.selectedLayerIndex,
      hiddenLayerIndexes: prev.hiddenLayerIndexes.filter((idx) => idx < features.length),
    })),
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
  setMapFeatureLayerType: (layerIndex, layerType) => set((state) => ({
    mapFeatureLayerTypes: { ...state.mapFeatureLayerTypes, [layerIndex]: layerType },
  })),
  clearMapFeatureLayerType: (layerIndex) => set((state) => {
    const updatedTypes = { ...state.mapFeatureLayerTypes };
    const updatedConfigs = { ...state.mapFeatureLayerConfigs };
    delete updatedTypes[layerIndex];
    delete updatedConfigs[layerIndex]; // Clear config when resetting type
    return { 
      mapFeatureLayerTypes: updatedTypes,
      mapFeatureLayerConfigs: updatedConfigs 
    };
  }),
  setMapFeatureLayerConfig: (layerIndex, config) => set((state) => ({
    mapFeatureLayerConfigs: {
      ...state.mapFeatureLayerConfigs,
      [layerIndex]: {
        ...(state.mapFeatureLayerConfigs[layerIndex] || {}),
        ...config
      }
    }
  })),
  resetMapFeatureLayerConfig: (layerIndex) => set((state) => {
    const updatedConfigs = { ...state.mapFeatureLayerConfigs };
    delete updatedConfigs[layerIndex];
    return { mapFeatureLayerConfigs: updatedConfigs };
  }),

  // ─── Layer Style Actions ─────────────────────────────────────
  setMapFeatureLayerStyle: (layerIndex, style) => set((state) => ({
    mapFeatureLayerStyles: { ...state.mapFeatureLayerStyles, [layerIndex]: style },
  })),
  clearMapFeatureLayerStyle: (layerIndex) => set((state) => {
    const updated = { ...state.mapFeatureLayerStyles };
    delete updated[layerIndex];
    return {
      mapFeatureLayerStyles: updated,
      activeStylePanelLayerIndex:
        state.activeStylePanelLayerIndex === layerIndex ? null : state.activeStylePanelLayerIndex,
    };
  }),
  clearAllLayerStyles: () => set({ mapFeatureLayerStyles: {}, activeStylePanelLayerIndex: null }),
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
