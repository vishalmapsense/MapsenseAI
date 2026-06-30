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

  executeCommands: (commands: MapCommand[]) => void;
  clearFeatures: () => void;
  setMapFeatures: (features: any[]) => void;
  setBaseMap: (baseMap: BaseMapType) => void;
  setMapViewState: (state: MapViewState) => void;
  setMapInstance: (map: Map | null) => void;
  setInteractionMode: (mode: string | null) => void;
}

export const useMapStore = create<MapState>((set) => ({
  mapFeatures: [],
  baseMap: "osm",
  mapViewState: null,
  mapInstance: null,
  interactionMode: null,

  executeCommands: (commands: MapCommand[]) => set((state) => {
    if (!commands || !Array.isArray(commands)) return state;

    let newFeatures = [...state.mapFeatures];
    let featuresChanged = false;

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
        map_add_marker: "ADD_MARKER",
        map_remove_marker: "REMOVE_MARKER",
        map_move_marker: "MOVE_MARKER",
        map_draw_point: "DRAW_POINT",
        map_draw_line: "DRAW_LINE",
        map_draw_polygon: "DRAW_POLYGON",
        map_draw_circle: "DRAW_CIRCLE",
        map_draw_rectangle: "DRAW_RECTANGLE",
        map_edit_geometry: "EDIT_GEOMETRY",
        map_delete_geometry: "DELETE_GEOMETRY",
        map_simplify_geometry: "SIMPLIFY_GEOMETRY",
        map_buffer_geometry: "BUFFER_GEOMETRY",
        map_split_polygon: "SPLIT_POLYGON",
        map_merge_polygons: "MERGE_POLYGONS",
      };
      
      if (commandMap[type]) {
        type = commandMap[type];
      }

      if (type === "CLEAR_MAP") {
        newFeatures = [];
        featuresChanged = true;
      } else if (type === "ADD_LAYER" && cmd.payload) {
        newFeatures.push(cmd.payload);
        featuresChanged = true;
      } else if (type === "ADD_MARKER" && cmd.payload?.lat !== undefined && cmd.payload?.lng !== undefined) {
        newFeatures.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [cmd.payload.lng, cmd.payload.lat]
          },
          properties: {
            name: cmd.payload.label || "Marker",
            type: "marker",
            zoom: cmd.payload.zoom || 14 // default to 14 if not provided
          }
        });
        featuresChanged = true;
      }
    });

    if (featuresChanged) {
      return { mapFeatures: newFeatures };
    }
    return {};
  }),

  clearFeatures: () => set({ mapFeatures: [] }),
  setMapFeatures: (features) => set({ mapFeatures: features }),
  setBaseMap: (baseMap) => set({ baseMap }),
  setMapViewState: (mapViewState) => set({ mapViewState }),
  setMapInstance: (mapInstance) => set({ mapInstance }),
  setInteractionMode: (interactionMode) => set({ interactionMode }),
}));
