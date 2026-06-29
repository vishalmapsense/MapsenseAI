import { create } from "zustand";

export type BaseMapType = "osm" | "carto-light" | "carto-dark" | "satellite";

export interface MapCommand {
  type: string;
  payload?: any;
}

interface MapState {
  mapFeatures: any[]; // Array of GeoJSON Feature or FeatureCollection
  baseMap: BaseMapType;
  
  executeCommands: (commands: MapCommand[]) => void;
  clearFeatures: () => void;
  setBaseMap: (baseMap: BaseMapType) => void;
}

export const useMapStore = create<MapState>((set) => ({
  mapFeatures: [],
  baseMap: "osm",
  
  executeCommands: (commands: MapCommand[]) => set((state) => {
    if (!commands || !Array.isArray(commands)) return state;
    
    let newFeatures = [...state.mapFeatures];
    
    commands.forEach(cmd => {
      if (cmd.type === "CLEAR_MAP") {
        newFeatures = [];
      } else if (cmd.type === "ADD_LAYER" && cmd.payload) {
        newFeatures.push(cmd.payload);
      }
      // Note: FIT_BOUNDS is handled automatically by OpenLayersMap when features change
      // or we can add a specific trigger state if needed later.
    });
    
    return { mapFeatures: newFeatures };
  }),
  
  clearFeatures: () => set({ mapFeatures: [] }),
  setBaseMap: (baseMap) => set({ baseMap })
}));
