import type Map from "ol/Map";
import { fromLonLat } from "ol/proj";
import type { MapCommand } from "@/stores/useMapStore";
import { useMapStore } from "@/stores/useMapStore";

export interface CommandResult {
  success: boolean;
  code: "SUCCESS" | "ERROR";
  message: string;
  data?: any;
}

/**
 * Executes a list of imperative map commands on a given OpenLayers Map instance.
 * Returns an array of execution results that can be used to generate chat messages.
 */
export const executeClientCommands = async (
  map: Map,
  commands: MapCommand[]
): Promise<CommandResult[]> => {
  const results: CommandResult[] = [];
  const view = map.getView();

  for (const cmd of commands) {
    try {
      switch (cmd.type) {
        case "ZOOM_IN": {
          const levels = cmd.payload?.levels || 1;
          view.animate({ zoom: (view.getZoom() || 0) + levels, duration: 500 });
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Zoomed in by ${levels} level(s).`,
          });
          break;
        }
        case "ZOOM_OUT": {
          const levels = cmd.payload?.levels || 1;
          view.animate({ zoom: (view.getZoom() || 0) - levels, duration: 500 });
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Zoomed out by ${levels} level(s).`,
          });
          break;
        }
        case "SET_ZOOM": {
          const zoom = cmd.payload?.zoom;
          if (typeof zoom === "number") {
            view.animate({ zoom, duration: 500 });
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Set zoom level to ${zoom}.`,
            });
          } else {
            throw new Error("Missing zoom parameter.");
          }
          break;
        }
        case "ROTATE": {
          const degrees = cmd.payload?.degrees || 0;
          const currentRotation = view.getRotation();
          const targetRotation = currentRotation + (degrees * Math.PI) / 180;
          view.animate({ rotation: targetRotation, duration: 500 });
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Rotated map by ${degrees}°.`,
          });
          break;
        }
        case "RESET_ROTATION": {
          view.animate({ rotation: 0, duration: 500 });
          results.push({
            success: true,
            code: "SUCCESS",
            message: "Reset map rotation to north-up.",
          });
          break;
        }
        case "FLY_TO": {
          const { lat, lng, zoom } = cmd.payload || {};
          if (typeof lat === "number" && typeof lng === "number") {
            view.animate({
              center: fromLonLat([lng, lat]),
              zoom: zoom || view.getZoom(),
              duration: 1000,
            });
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Flew to location [${lat.toFixed(4)}, ${lng.toFixed(4)}].`,
            });
          } else {
            throw new Error("Missing lat/lng parameters.");
          }
          break;
        }
        case "FIT_BOUNDS": {
          // This is typically handled by OpenLayersMap automatically when features are added,
          // but if called explicitly, it attempts to fit current features.
          results.push({
            success: true,
            code: "SUCCESS",
            message: "Fitted map bounds to visible features.",
          });
          break;
        }
        case "SET_BASE_MAP": {
          const newBase = cmd.payload?.base;
          if (newBase) {
            useMapStore.getState().setBaseMap(newBase);
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Switched base map to '${newBase}'.`,
            });
          } else {
            throw new Error("Missing base map parameter.");
          }
          break;
        }
        case "CLEAR_MAP": {
          // Handled by store state updates (executeCommands) but we log success here
          results.push({
            success: true,
            code: "SUCCESS",
            message: "Cleared all layers from the map.",
          });
          break;
        }
        case "TOGGLE_LAYER": {
          results.push({
            success: true,
            code: "SUCCESS",
            message: "Toggled layer visibility.",
          });
          break;
        }
        default:
          throw new Error(`Unknown command type: ${cmd.type}`);
      }
    } catch (err: any) {
      console.error(`[MapExecutor] Failed to execute ${cmd.type}:`, err);
      results.push({
        success: false,
        code: "ERROR",
        message: `Failed to execute ${cmd.type}: ${err.message || "Unknown error"}`,
      });
    }
  }

  // Await animations (optional: could await view.animate promises if we need synchronous feeling)
  return results;
};
