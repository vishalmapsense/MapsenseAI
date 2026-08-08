import { create } from "zustand";


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
    | "REQUEST_PERMISSION";
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

  clearFeatures: () => set({ mapFeatures: [], selectedLayerIndex: null }),
  triggerZoomToFit: () => set((state) => ({ zoomTrigger: state.zoomTrigger + 1 })),
  setMapFeatures: (features) =>
    set((prev) => ({
      mapFeatures: features,
      selectedLayerIndex:
        prev.selectedLayerIndex !== null && prev.selectedLayerIndex >= features.length
          ? null
          : prev.selectedLayerIndex,
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
}));
