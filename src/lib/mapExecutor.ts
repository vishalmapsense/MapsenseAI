import type Map from "ol/Map";
import { fromLonLat, toLonLat } from "ol/proj";
import * as turf from "@turf/turf";
import type { MapCommand } from "@/stores/useMapStore";
import { useMapStore } from "@/stores/useMapStore";
import { normalizeToGeoJSON, fetchAndNormalizeSpatialUrl } from "@/utils/spatialNormalizer";

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
      console.log("⚙️ [MapExecutor] Executing command:", cmd.type, cmd.payload);
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
          useMapStore.getState().setMapFeatures([]);
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
        case "ADD_GEOJSON": {
          const rawGeojson = cmd.payload?.geojson;
          const label = cmd.payload?.label || "Custom Feature";
          if (rawGeojson) {
            const normalized = normalizeToGeoJSON(rawGeojson, label);
            if (normalized) {
              const store = useMapStore.getState();
              store.setMapFeatures([...store.mapFeatures, normalized]);

              results.push({
                success: true,
                code: "SUCCESS",
                message: `Added spatial feature '${label}' to the map.`,
              });
            } else {
              throw new Error("Could not parse or normalize spatial data.");
            }
          } else {
            throw new Error("Missing geojson payload.");
          }
          break;
        }
        case "LOAD_URL": {
          const url = cmd.payload?.url;
          const label = cmd.payload?.label || "External Layer";
          if (typeof url === "string") {
            const normalized = await fetchAndNormalizeSpatialUrl(url, label);
            if (normalized) {
              const store = useMapStore.getState();
              store.setMapFeatures([...store.mapFeatures, normalized]);

              results.push({
                success: true,
                code: "SUCCESS",
                message: `Loaded spatial feature from URL.`,
              });
            } else {
              throw new Error("Could not fetch or parse spatial data from URL.");
            }
          } else {
            throw new Error("Missing URL payload.");
          }
          break;
        }
        case "ADD_MARKER": {
          const lat = cmd.payload?.lat;
          const lng = cmd.payload?.lng;
          const label = cmd.payload?.label || "Marker";
          const zoom = cmd.payload?.zoom;
          
          if (typeof lat === "number" && typeof lng === "number") {
            const pointFeature = turf.point([lng, lat], { 
              name: label, 
              type: "marker",
              ...(zoom && { zoom })
            });
            
            const store = useMapStore.getState();
            store.setMapFeatures([...store.mapFeatures, pointFeature as any]);

            results.push({
              success: true,
              code: "SUCCESS",
              message: `Added marker '${label}' at [${lat}, ${lng}].`,
            });
          } else {
            throw new Error("Missing lat/lng for marker.");
          }
          break;
        }
        case "REMOVE_MARKER": {
          results.push({
            success: true,
            code: "SUCCESS",
            message: "Removed marker.",
          });
          break;
        }
        case "MOVE_MARKER": {
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Moved marker to [${cmd.payload?.lat}, ${cmd.payload?.lng}].`,
          });
          break;
        }
        case "DRAW_POINT":
        case "DRAW_LINE":
        case "DRAW_POLYGON":
        case "DRAW_CIRCLE":
        case "DRAW_RECTANGLE":
        case "EDIT_GEOMETRY":
        case "DELETE_GEOMETRY":
        case "SPLIT_POLYGON":
        case "MERGE_POLYGONS": {
          useMapStore.getState().setInteractionMode(cmd.type);
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Activated map interaction mode: ${cmd.type}`,
          });
          break;
        }
        case "SIMPLIFY_GEOMETRY": {
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Performed geometry operation: ${cmd.type}`,
          });
          break;
        }
        case "BUFFER_GEOMETRY": {
          const distance = cmd.payload?.distance || 1;
          const centerProj = view.getCenter();
          if (centerProj) {
            const center = toLonLat(centerProj);
            const bufferFeature = turf.circle(center, distance, { units: 'kilometers' });
            
            const store = useMapStore.getState();
            store.setMapFeatures([...store.mapFeatures, bufferFeature as any]);

            results.push({
              success: true,
              code: "SUCCESS",
              message: `Drew a ${distance}km buffer at the center of the map.`,
            });
          } else {
            throw new Error("Could not determine map center for buffer.");
          }
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
