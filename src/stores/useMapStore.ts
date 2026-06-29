import { create } from "zustand";
import type Map from "ol/Map";

export type BaseMapType = "osm" | "carto-light" | "carto-dark" | "satellite";

export interface MapCommand {
  type:
    | "ADD_LAYER"
    | "CLEAR_MAP"
    | "FIT_BOUNDS"
    | "ZOOM_IN"
    | "ZOOM_OUT"
    | "SET_ZOOM"
    | "ROTATE"
    | "RESET_ROTATION"
    | "FLY_TO"
    | "SET_BASE_MAP"
    | "TOGGLE_LAYER";
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

  executeCommands: (commands: MapCommand[]) => void;
  clearFeatures: () => void;
  setBaseMap: (baseMap: BaseMapType) => void;
  setMapViewState: (state: MapViewState) => void;
  setMapInstance: (map: Map | null) => void;
}

export const useMapStore = create<MapState>((set) => ({
  mapFeatures: [],
  baseMap: "osm",
  mapViewState: null,
  mapInstance: null,

  executeCommands: (commands: MapCommand[]) => set((state) => {
    if (!commands || !Array.isArray(commands)) return state;

    let newFeatures = [...state.mapFeatures];

    commands.forEach(cmd => {
      let type = cmd.type;
      const commandMap: Record<string, MapCommand["type"]> = {
        map_zoom_in: "ZOOM_IN",
        map_zoom_out: "ZOOM_OUT",
        map_set_zoom: "SET_ZOOM",
        map_rotate: "ROTATE",
        map_reset_rotation: "RESET_ROTATION",
        map_fly_to: "FLY_TO",
        map_fit_bounds: "FIT_BOUNDS",
        map_set_base: "SET_BASE_MAP",
        map_clear_layers: "CLEAR_MAP",
        map_toggle_layer: "TOGGLE_LAYER",
      };
      
      if (commandMap[type]) {
        type = commandMap[type];
      }

      if (type === "CLEAR_MAP") {
        newFeatures = [];
      } else if (type === "ADD_LAYER" && cmd.payload) {
        newFeatures.push(cmd.payload);
      }
    });

    return {
      mapFeatures: newFeatures,
    };
  }),

  clearFeatures: () => set({ mapFeatures: [] }),
  setBaseMap: (baseMap) => set({ baseMap }),
  setMapViewState: (mapViewState) => set({ mapViewState }),
  setMapInstance: (mapInstance) => set({ mapInstance }),
}));
