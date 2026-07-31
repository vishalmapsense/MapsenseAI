import { create } from "zustand";
import type Map from "ol/Map";

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
    | "MERGE_POLYGONS";
  payload?: any;
}

export interface MapViewState {
  center: [number, number];
  zoom: number;
  rotation: number;
}

interface MapState {
  mapFeatures: any[]; // Array of GeoJSON Feature or FeatureCollection
  baseMap: BaseMapType;
  mapViewState: MapViewState | null; // Track current map viewport state
  mapInstance: Map | null;
  interactionMode: string | null; // e.g. 'draw_polygon', 'edit', 'delete', null
  hoverInfo: { props: Record<string, any>; x: number; y: number } | null;

  clearFeatures: () => void;
  setMapFeatures: (features: any[]) => void;
  setBaseMap: (baseMap: BaseMapType) => void;
  setMapViewState: (state: MapViewState) => void;
  setMapInstance: (map: Map | null) => void;
  setInteractionMode: (mode: string | null) => void;
  setHoverInfo: (info: { props: Record<string, any>; x: number; y: number } | null) => void;
}

export const useMapStore = create<MapState>((set) => ({
  mapFeatures: [],
  baseMap: "osm",
  mapViewState: null,
  mapInstance: null,
  interactionMode: null,
  hoverInfo: null,

  clearFeatures: () => set({ mapFeatures: [] }),
  setMapFeatures: (features) => set({ mapFeatures: features }),
  setBaseMap: (baseMap) => set({ baseMap }),
  setMapViewState: (mapViewState) => set({ mapViewState }),
  setMapInstance: (mapInstance) => set({ mapInstance }),
  setInteractionMode: (interactionMode) => set({ interactionMode }),
  setHoverInfo: (hoverInfo) => set({ hoverInfo }),
}));
