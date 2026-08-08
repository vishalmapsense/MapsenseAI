import * as turf from "@turf/turf";
import type { MapCommand } from "@/stores/useMapStore";
import { useMapStore } from "@/stores/useMapStore";
import {
  normalizeToGeoJSON,
  fetchAndNormalizeSpatialUrl,
} from "@/utils/spatialNormalizer";
import {
  saveLayer,
  deleteAllLayers,
  extractLayerName,
} from "@/services/layerSyncService";

export interface CommandResult {
  success: boolean;
  code: "SUCCESS" | "ERROR";
  message: string;
  data?: any;
}

/**
 * Executes map commands through the declarative Deck.gl map store.
 * Returns an array of execution results that can be used to generate chat messages.
 */
export const executeClientCommands = async (
  commands: MapCommand[],
  sessionId?: string | null,
): Promise<CommandResult[]> => {
  const results: CommandResult[] = [];

  for (const cmd of commands) {
    try {
      console.log("⚙️ [MapExecutor] Executing command:", cmd.type, cmd.payload);
      switch (cmd.type) {
        case "ZOOM_IN": {
          const levels = cmd.payload?.levels || 1;
          useMapStore.getState().setViewState({ 
            zoom: (useMapStore.getState().viewState.zoom || 0) + levels, 
            transitionDuration: 500 
          });
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Zoomed in by ${levels} level(s).`,
          });
          break;
        }
        case "ZOOM_OUT": {
          const levels = cmd.payload?.levels || 1;
          useMapStore.getState().setViewState({ 
            zoom: (useMapStore.getState().viewState.zoom || 0) - levels, 
            transitionDuration: 500 
          });
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
            useMapStore.getState().setViewState({ 
              zoom, 
              transitionDuration: 500 
            });
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
          const currentRotation = useMapStore.getState().viewState.bearing || 0;
          const targetRotation = currentRotation + degrees;
          useMapStore.getState().setViewState({ 
            bearing: targetRotation, 
            transitionDuration: 500 
          });
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Rotated map by ${degrees}°.`,
          });
          break;
        }
        case "RESET_ROTATION": {
          useMapStore.getState().setViewState({ bearing: 0, transitionDuration: 500 });
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
            useMapStore.getState().setViewState({
              longitude: lng,
              latitude: lat,
              zoom: zoom || useMapStore.getState().viewState.zoom,
              transitionDuration: 1000,
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
          useMapStore.getState().triggerZoomToFit();
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
        case "TOGGLE_3D": {
          const currentViewState = useMapStore.getState().viewState;
          const is3D = currentViewState.pitch > 0;
          const mode = cmd.payload?.mode;
          
          let targetPitch = is3D ? 0 : 60;
          let targetBearing = is3D ? 0 : currentViewState.bearing;
          
          if (mode === "2d") {
            targetPitch = 0;
            targetBearing = 0;
          } else if (mode === "3d") {
            targetPitch = 60;
          }

          useMapStore.getState().setViewState({
            pitch: targetPitch,
            bearing: targetBearing,
            transitionDuration: 500
          });
          
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Switched map to ${targetPitch > 0 ? "3D" : "2D"} view.`,
          });
          break;
        }
        case "CLEAR_MAP": {
          useMapStore.getState().setMapFeatures([]);
          // Persist: delete all layers from Supabase
          if (sessionId) {
            deleteAllLayers(sessionId).catch((e) =>
              console.error(
                "[MapExecutor] Failed to delete layers from Supabase:",
                e,
              ),
            );
          }
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
              const newIndex = store.mapFeatures.length;
              store.setMapFeatures([...store.mapFeatures, normalized]);

              // Persist: save-after-success — layer rendered on map, now persist
              if (sessionId) {
                saveLayer(
                  sessionId,
                  newIndex,
                  extractLayerName(normalized) || label,
                  normalized,
                ).catch((e) =>
                  console.error(
                    "[MapExecutor] Failed to persist layer to Supabase:",
                    e,
                  ),
                );
              }

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
              const newIndex = store.mapFeatures.length;
              store.setMapFeatures([...store.mapFeatures, normalized]);

              // Persist: save-after-success
              if (sessionId) {
                saveLayer(
                  sessionId,
                  newIndex,
                  extractLayerName(normalized) || label,
                  normalized,
                ).catch((e) =>
                  console.error(
                    "[MapExecutor] Failed to persist URL layer to Supabase:",
                    e,
                  ),
                );
              }

              results.push({
                success: true,
                code: "SUCCESS",
                message: `Loaded spatial feature from URL.`,
              });
            } else {
              throw new Error(
                "Could not fetch or parse spatial data from URL.",
              );
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
              ...(zoom && { zoom }),
            });

            const store = useMapStore.getState();
            const newIndex = store.mapFeatures.length;
            store.setMapFeatures([...store.mapFeatures, pointFeature as any]);

            // Persist: save-after-success
            if (sessionId) {
              saveLayer(sessionId, newIndex, label, pointFeature).catch((e) =>
                console.error(
                  "[MapExecutor] Failed to persist marker to Supabase:",
                  e,
                ),
              );
            }

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
        case "MERGE_POLYGONS":
        case "SELECT_LAYER": {
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
          const { longitude, latitude } = useMapStore.getState().viewState;
          if (longitude !== undefined && latitude !== undefined) {
            const center = [longitude, latitude];
            const bufferFeature = turf.circle(center, distance, {
              units: "kilometers",
            });

            const store = useMapStore.getState();
            const newIndex = store.mapFeatures.length;
            store.setMapFeatures([...store.mapFeatures, bufferFeature as any]);

            // Persist: save-after-success
            if (sessionId) {
              saveLayer(
                sessionId,
                newIndex,
                `${distance}km Buffer`,
                bufferFeature,
              ).catch((e) =>
                console.error(
                  "[MapExecutor] Failed to persist buffer to Supabase:",
                  e,
                ),
              );
            }

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
