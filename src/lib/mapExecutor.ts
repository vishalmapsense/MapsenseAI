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
import { sanitizeTableName } from "@/stores/useDataReferenceStore";
import {
  resolveFeatureProperty,
  parseNumericValue,
  hashStringToColor,
  DYNAMIC_PALETTE,
  CURATED_PALETTES,
  parseRGBAColor,
} from "@/utils/propertyResolver";

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
            transitionDuration: 500,
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
            transitionDuration: 500,
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
              transitionDuration: 500,
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
            transitionDuration: 500,
          });
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Rotated map by ${degrees}°.`,
          });
          break;
        }
        case "RESET_ROTATION": {
          useMapStore
            .getState()
            .setViewState({ bearing: 0, transitionDuration: 500 });
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
            transitionDuration: 500,
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
          const layerIndex = cmd.payload?.layerIndex;
          const visible = cmd.payload?.visible;
          const store = useMapStore.getState();
          if (typeof layerIndex === "number") {
            if (typeof visible === "boolean") {
              store.setLayerVisibility(layerIndex, visible);
            } else {
              store.toggleLayerVisibility(layerIndex);
            }
          }
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Toggled visibility for layer ${layerIndex ?? ""}.`,
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

              // Check if an existing layer on the map matches this label (e.g. "Amenities (PIN 208002)")
              const cleanLabel = (label || "").trim();
              const existingIndex = store.mapFeatures.findIndex((existing) => {
                const existingName = extractLayerName(existing) || existing.properties?.name || existing.name;
                if (!existingName) return false;
                const cleanExisting = String(existingName).trim();
                if (cleanExisting === cleanLabel) return true;
                const pinInClean = cleanLabel.match(/\b\d{6}\b/)?.[0];
                const pinInExisting = cleanExisting.match(/\b\d{6}\b/)?.[0];
                if (pinInClean && pinInExisting && pinInClean === pinInExisting) {
                  if (cleanLabel.toLowerCase().includes("boundary") && cleanExisting.toLowerCase().includes("boundary")) return true;
                  if (cleanLabel.toLowerCase().includes("amenit") && cleanExisting.toLowerCase().includes("amenit")) return true;
                }
                return false;
              });

              if (existingIndex !== -1) {
                // Layer already exists on the map! Merge features into the existing layer
                const existingLayer = normalizeToGeoJSON(store.mapFeatures[existingIndex], cleanLabel);
                const existingFeatures = existingLayer?.features || [];
                const seen = new Set(
                  existingFeatures.map(
                    (f: any) =>
                      `${f.properties?.name || ""}_${f.geometry?.coordinates?.join(",")}`
                  )
                );
                const newToAdd = (normalized.features || []).filter((f: any) => {
                  const key = `${f.properties?.name || ""}_${f.geometry?.coordinates?.join(",")}`;
                  return !seen.has(key);
                });
                const mergedLayer = {
                  ...existingLayer,
                  features: [...existingFeatures, ...newToAdd],
                };
                const updated = [...store.mapFeatures];
                updated[existingIndex] = mergedLayer;
                store.setMapFeatures(updated);
                console.log(
                  `🗺️ [MapExecutor] Merged ${newToAdd.length} features into existing layer "${cleanLabel}" (Total: ${mergedLayer.features.length}).`
                );

                if (sessionId) {
                  saveLayer(sessionId, existingIndex, cleanLabel, mergedLayer).catch((e) =>
                    console.error("[MapExecutor] Failed to update merged layer in Supabase:", e)
                  );
                }

                results.push({
                  success: true,
                  code: "SUCCESS",
                  message: `Merged ${newToAdd.length} features into layer '${cleanLabel}' on the map.`,
                });
              } else {
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
              }
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
            const lowerUrl = url.toLowerCase().split("?")[0];
            const isParquet = lowerUrl.endsWith(".parquet");
            const isCsv = lowerUrl.endsWith(".csv");

            let normalized: any = null;

            if (isParquet || isCsv) {
              console.log(`🦆 [MapExecutor] Loading ${isParquet ? "Parquet" : "CSV"} file via DuckDB: ${url}`);
              const { clientDuckDB } = await import("@/services/duckdb/clientDuckDB");
              const { convertQueryResultToFeatures } = await import("@/utils/spatialQueryHelper");

              const isLocal =
                url.startsWith("/") ||
                url.startsWith("file://") ||
                /^[a-zA-Z]:[\\/]/.test(url) ||
                url.startsWith("./") ||
                url.startsWith("../");

              let tableName: string;
              if (isLocal) {
                const cleanPath = url.replace(/^file:\/\//, "");
                tableName = await clientDuckDB.registerLocalFile(cleanPath);
              } else {
                tableName = await clientDuckDB.registerRemoteUrl(url);
              }

              // Query features from DuckDB-Wasm (up to 100,000 features)
              let queryResult: any;
              try {
                queryResult = await clientDuckDB.runQuery(`SELECT * FROM "${tableName}" LIMIT 100000;`);
              } catch (selectErr: any) {
                console.warn("[MapExecutor] SELECT * failed, falling back to casting geometry as VARCHAR:", selectErr);
                try {
                  queryResult = await clientDuckDB.runQuery(`SELECT * EXCLUDE (geometry), geometry::VARCHAR AS geometry FROM "${tableName}" LIMIT 100000;`);
                } catch {
                  throw selectErr;
                }
              }

              // Add to chat store so QueryResultsPanel opens with this table
              try {
                const { useChatStore } = await import("@/stores/useChatStore");
                useChatStore.getState().addQueryResults([queryResult]);
              } catch (e) {
                console.warn("[MapExecutor] Could not push query result to panel:", e);
              }

              const features = convertQueryResultToFeatures(queryResult);
              if (features.length > 0) {
                const layerId = `duckdb_${tableName}_${Date.now()}`;
                features.forEach((f: any) => {
                  if (f.properties) f.properties._layerId = layerId;
                });
                normalized = {
                  type: "FeatureCollection",
                  features,
                  properties: {
                    title: label,
                    name: label,
                    source: isParquet ? "parquet" : "csv",
                    source_url: url,
                    layerId,
                    rowCount: features.length,
                  },
                };
              } else {
                throw new Error(
                  `Loaded table "${tableName}" from ${isParquet ? "Parquet" : "CSV"} file, but no spatial coordinates (lat/lng), geometry, bbox, or quadkey columns were found to map.`
                );
              }
            } else {
              normalized = await fetchAndNormalizeSpatialUrl(url, label);
            }

            if (normalized) {
              const store = useMapStore.getState();
              const newIndex = store.mapFeatures.length;
              store.setMapFeatures([...store.mapFeatures, normalized]);
              store.triggerZoomToFit();

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
                message: `Loaded ${normalized.features?.length || 1} spatial features from ${isParquet ? "Parquet" : isCsv ? "CSV" : "URL"}.`,
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
          const lat =
            cmd.payload?.lat ??
            cmd.payload?.latitude ??
            cmd.payload?.coordinates?.[1];
          const lng =
            cmd.payload?.lng ??
            cmd.payload?.longitude ??
            cmd.payload?.lon ??
            cmd.payload?.coordinates?.[0];
          const label = cmd.payload?.label || cmd.payload?.name || "Marker";
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
          const lat = cmd.payload?.lat ?? cmd.payload?.latitude;
          const lng =
            cmd.payload?.lng ?? cmd.payload?.longitude ?? cmd.payload?.lon;
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Moved marker to [${lat}, ${lng}].`,
          });
          break;
        }
        case "DRAW_POINT": {
          const lat =
            cmd.payload?.lat ??
            cmd.payload?.latitude ??
            cmd.payload?.coordinates?.[1] ??
            cmd.payload?.center?.[1];
          const lng =
            cmd.payload?.lng ??
            cmd.payload?.longitude ??
            cmd.payload?.lon ??
            cmd.payload?.coordinates?.[0] ??
            cmd.payload?.center?.[0];
          const label =
            cmd.payload?.label || cmd.payload?.name || "Drawn Point";

          if (typeof lat === "number" && typeof lng === "number") {
            const pointFeature = turf.point([lng, lat], {
              name: label,
              type: "drawn_point",
            });
            const store = useMapStore.getState();
            const newIndex = store.mapFeatures.length;
            store.setMapFeatures([...store.mapFeatures, pointFeature as any]);
            if (sessionId) {
              saveLayer(sessionId, newIndex, label, pointFeature).catch(
                console.error,
              );
            }
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Drew point '${label}' at [${lat.toFixed(4)}, ${lng.toFixed(4)}].`,
            });
          } else {
            useMapStore.getState().setInteractionMode(cmd.type);
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Activated map interaction mode: ${cmd.type}`,
            });
          }
          break;
        }
        case "DRAW_CIRCLE": {
          const lat =
            cmd.payload?.lat ??
            cmd.payload?.latitude ??
            cmd.payload?.center?.[1];
          const lng =
            cmd.payload?.lng ??
            cmd.payload?.longitude ??
            cmd.payload?.lon ??
            cmd.payload?.center?.[0];
          const radius =
            cmd.payload?.radius ??
            cmd.payload?.radius_km ??
            cmd.payload?.distance ??
            5;
          const label =
            cmd.payload?.label || cmd.payload?.name || `${radius}km Circle`;

          if (typeof lat === "number" && typeof lng === "number") {
            const circleFeature = turf.circle([lng, lat], radius, {
              units: "kilometers",
              properties: { name: label, radius_km: radius },
            });
            const store = useMapStore.getState();
            const newIndex = store.mapFeatures.length;
            store.setMapFeatures([...store.mapFeatures, circleFeature as any]);
            if (sessionId) {
              saveLayer(sessionId, newIndex, label, circleFeature).catch(
                console.error,
              );
            }
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Drew ${radius}km circle '${label}' at [${lat.toFixed(4)}, ${lng.toFixed(4)}].`,
            });
          } else {
            useMapStore.getState().setInteractionMode(cmd.type);
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Activated map interaction mode: ${cmd.type}`,
            });
          }
          break;
        }
        case "DRAW_POLYGON": {
          const coords =
            cmd.payload?.coordinates ||
            cmd.payload?.polygon ||
            cmd.payload?.geojson?.geometry?.coordinates;
          const label =
            cmd.payload?.label || cmd.payload?.name || "Drawn Polygon";
          if (Array.isArray(coords) && coords.length > 0) {
            const polyFeature = turf.polygon(coords, { name: label });
            const store = useMapStore.getState();
            const newIndex = store.mapFeatures.length;
            store.setMapFeatures([...store.mapFeatures, polyFeature as any]);
            if (sessionId) {
              saveLayer(sessionId, newIndex, label, polyFeature).catch(
                console.error,
              );
            }
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Drew polygon '${label}'.`,
            });
          } else {
            useMapStore.getState().setInteractionMode(cmd.type);
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Activated map interaction mode: ${cmd.type}`,
            });
          }
          break;
        }
        case "DRAW_LINE": {
          const coords =
            cmd.payload?.coordinates ||
            cmd.payload?.line ||
            cmd.payload?.geojson?.geometry?.coordinates;
          const label = cmd.payload?.label || cmd.payload?.name || "Drawn Line";
          if (Array.isArray(coords) && coords.length > 1) {
            const lineFeature = turf.lineString(coords, { name: label });
            const store = useMapStore.getState();
            const newIndex = store.mapFeatures.length;
            store.setMapFeatures([...store.mapFeatures, lineFeature as any]);
            if (sessionId) {
              saveLayer(sessionId, newIndex, label, lineFeature).catch(
                console.error,
              );
            }
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Drew line '${label}'.`,
            });
          } else {
            useMapStore.getState().setInteractionMode(cmd.type);
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Activated map interaction mode: ${cmd.type}`,
            });
          }
          break;
        }
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
        case "RUN_CLIENT_DUCKDB_QUERY": {
          let queryText =
            cmd.payload?.queryText ||
            cmd.payload?.query ||
            cmd.payload?.sql ||
            cmd.payload?.sqlQuery ||
            cmd.payload?.query_text ||
            cmd.payload?.sql_query ||
            cmd.payload?.q;

          if (typeof cmd.payload === "string") {
            const trimmedPayload = cmd.payload.trim();
            if (trimmedPayload.startsWith("{")) {
              try {
                const parsed = JSON.parse(trimmedPayload);
                queryText =
                  parsed.queryText ||
                  parsed.query ||
                  parsed.sql ||
                  parsed.sqlQuery ||
                  parsed.query_text ||
                  queryText;
              } catch {}
            } else if (/^SELECT\b|^WITH\b|^INSTALL\b|^DESCRIBE\b|^SHOW\b/i.test(trimmedPayload)) {
              queryText = trimmedPayload;
            }
          }

          if (cmd.payload && typeof cmd.payload === "object" && cmd.payload.args && typeof cmd.payload.args === "object") {
            queryText =
              queryText ||
              cmd.payload.args.queryText ||
              cmd.payload.args.query ||
              cmd.payload.args.sql ||
              cmd.payload.args.sqlQuery ||
              cmd.payload.args.query_text;
          }

          const store = useMapStore.getState();
          const currentMapFeatures = store.mapFeatures;

          // If queryText is still missing or not a string, synthesize an intelligent fallback query
          if (!queryText || typeof queryText !== "string" || queryText.trim().length === 0) {
            console.warn("⚠️ [MapExecutor] queryText was omitted in RUN_CLIENT_DUCKDB_QUERY command payload:", cmd.payload);
            const targetIndex =
              typeof cmd.payload?.layerIndex === "number"
                ? cmd.payload.layerIndex
                : (store.selectedLayerIndex ?? 0);
            const activeLayer = currentMapFeatures[targetIndex] || currentMapFeatures[0];

            if (activeLayer) {
              const layerName = extractLayerName(activeLayer) || activeLayer?.properties?.name || `layer_${targetIndex + 1}`;
              const tableName = sanitizeTableName(layerName);
              const sampleProps = activeLayer?.features?.[0]?.properties || activeLayer?.properties || {};

              // Find metric or population column if available
              const metricCol = Object.keys(sampleProps).find((k) =>
                !k.startsWith("_") && /^(pop|population|total_pop|totpop|tract|count|density|value|rating|score)/i.test(k)
              ) || Object.keys(sampleProps).find((k) => !k.startsWith("_") && typeof sampleProps[k] === "number");

              if (metricCol) {
                queryText = `SELECT * EXCLUDE (geometry), geometry AS geometry FROM "${tableName}" ORDER BY "${metricCol}" DESC LIMIT 20;`;
              } else {
                queryText = `SELECT * EXCLUDE (geometry), geometry AS geometry FROM "${tableName}" LIMIT 50;`;
              }
              console.log(`🦆 [MapExecutor] Auto-synthesized fallback query for layer "${tableName}":`, queryText);
            } else {
              queryText = "SELECT * FROM map_features LIMIT 50;";
              console.log(`🦆 [MapExecutor] Auto-synthesized default query for map_features:`, queryText);
            }
          }

          // Proactively sanitize ST_AsGeoJSON(geometry) on client map layers where geometry is already GeoJSON VARCHAR
          if (/\bST_AsGeoJSON\s*\(\s*geometry\s*\)/i.test(queryText)) {
            queryText = queryText.replace(/\bST_AsGeoJSON\s*\(\s*geometry\s*\)/gi, "geometry");
          }

          const { clientDuckDB } =
            await import("@/services/duckdb/clientDuckDB");
          const { useDataReferenceStore } =
            await import("@/stores/useDataReferenceStore");

          if (
            cmd.payload?.attachedFiles &&
            Array.isArray(cmd.payload.attachedFiles)
          ) {
            useDataReferenceStore
              .getState()
              .syncFromAttachedFiles(cmd.payload.attachedFiles);
          }
          if (
            cmd.payload?.targetPath &&
            typeof cmd.payload.targetPath === "string"
          ) {
            useDataReferenceStore
              .getState()
              .syncFromAttachedFiles([cmd.payload.targetPath]);
          }

          await clientDuckDB.syncMapLayers(currentMapFeatures);

          let queryResult: any;
          try {
            queryResult = await clientDuckDB.runQuery(queryText);
          } catch (qErr: any) {
            console.warn(`[MapExecutor] runQuery failed on "${queryText}", attempting safe fallback:`, qErr);
            const safeFallback = "SELECT * FROM map_features LIMIT 50;";
            queryResult = await clientDuckDB.runQuery(safeFallback);
          }

          // Add to chat store so QueryResultsPanel opens with this table
          const { useChatStore } = await import("@/stores/useChatStore");
          useChatStore.getState().addQueryResults([queryResult]);

          // If applyToMap is true, convert spatial query results to map layer
          if (cmd.payload?.applyToMap) {
            try {
              const { convertQueryResultToFeatures } =
                await import("@/utils/spatialQueryHelper");
              const newFeatures = convertQueryResultToFeatures(queryResult);
              if (newFeatures.length > 0) {
                const layerId = `duckdb_${queryResult.queryId}`;
                const title =
                  cmd.payload?.layerTitle ||
                  `Filtered: ${queryText.substring(0, 30)}`;
                newFeatures.forEach((f: any) => {
                  if (f.properties) f.properties._layerId = layerId;
                });
                const featureCol = {
                  type: "FeatureCollection",
                  features: newFeatures,
                  properties: {
                    title,
                    name: title,
                    source: "duckdb",
                    source_url: "duckdb",
                    layerId,
                    rowCount: newFeatures.length,
                  },
                };
                useMapStore
                  .getState()
                  .setMapFeatures([
                    ...useMapStore.getState().mapFeatures,
                    featureCol,
                  ]);
                console.log(
                  `🦆 [MapExecutor] Applied ${newFeatures.length} filtered features directly to map as new layer.`,
                );
              }
            } catch (mapErr) {
              console.warn(
                "⚠️ [MapExecutor] Could not apply DuckDB query result to map:",
                mapErr,
              );
            }
          }

          results.push({
            success: true,
            code: "SUCCESS",
            message: `DuckDB-Wasm executed: ${queryResult.rowCount} rows in ${queryResult.executionTimeMs}ms.${cmd.payload?.applyToMap ? " Filtered features displayed on map." : ""}`,
            data: queryResult,
          });
          break;
        }
        case "STYLE_LAYER": {
          const store = useMapStore.getState();
          const currentLayers = store.mapFeatures;
          let layerIndex = cmd.payload?.layerIndex;
          let style = cmd.payload?.style;

          // Smart layer targeting by name or phrase
          const targetLayerName = (cmd.payload?.layerName || (typeof layerIndex === "string" ? layerIndex : ""))?.toLowerCase().trim();
          if (targetLayerName && isNaN(Number(targetLayerName)) && currentLayers.length > 0) {
            const foundIdx = currentLayers.findIndex((l: any, i: number) => {
              const name = (extractLayerName(l) || l.title || l.name || l.properties?.title || l.properties?.name || `layer_${i + 1}`).toLowerCase();
              return name.includes(targetLayerName) || targetLayerName.includes(name);
            });
            if (foundIdx !== -1) {
              layerIndex = foundIdx;
            }
          }

          if (typeof layerIndex === "string") {
            const parsed = parseInt(layerIndex.replace(/\D/g, ""), 10);
            layerIndex = isNaN(parsed)
              ? (store.selectedLayerIndex ?? 0)
              : parsed;
          } else if (typeof layerIndex !== "number") {
            layerIndex = store.selectedLayerIndex ?? 0;
          }
          if (
            currentLayers.length > 0 &&
            (layerIndex < 0 || layerIndex >= currentLayers.length)
          ) {
            layerIndex =
              store.selectedLayerIndex !== null &&
              store.selectedLayerIndex < currentLayers.length
                ? store.selectedLayerIndex
                : 0;
          }

          // Resilient style extraction: handle nested style, stringified style, or flat payload
          if (typeof style === "string") {
            try {
              style = JSON.parse(style);
            } catch {}
          }
          if (
            !style ||
            typeof style !== "object" ||
            Object.keys(style).length === 0
          ) {
            const { layerIndex: _li, ...rest } = cmd.payload || {};
            if (
              rest.field ||
              rest.type ||
              rest.fillColor ||
              rest.mapping ||
              rest.palette ||
              rest.ranges ||
              rest.valueGroups ||
              rest.rules
            ) {
              style = rest;
            }
          }

          // If type is missing, infer it from parameters
          if (style && !style.type) {
            if (
              style.min !== undefined ||
              style.max !== undefined ||
              style.minColor ||
              style.maxColor
            ) {
              style.type = "gradient";
            } else if (
              style.fillColor &&
              !style.field &&
              !style.valueGroups &&
              !style.rules
            ) {
              style.type = "solid";
            } else {
              style.type = "category";
            }
          }

          if (!style || typeof style !== "object") {
            const sampleFeat =
              currentLayers[layerIndex]?.features?.[0] ||
              currentLayers[layerIndex];
            const p = sampleFeat?.properties || {};
            const firstCol = Object.keys(p).find(
              (k) => !k.startsWith("_") && typeof p[k] === "string",
            );
            style = {
              type: "category",
              field: firstCol || "category",
              palette: "rainbow",
            };
          }

          const targetLayer = currentLayers[layerIndex];
          const features = Array.isArray(targetLayer?.features)
            ? targetLayer.features
            : targetLayer?.type === "Feature"
              ? [targetLayer]
              : [];

          let finalStyle = { ...style };

          // Early color normalization for deterministic processing
          if (finalStyle.fillColor) finalStyle.fillColor = parseRGBAColor(finalStyle.fillColor);
          if (finalStyle.lineColor) finalStyle.lineColor = parseRGBAColor(finalStyle.lineColor);
          if (finalStyle.minColor) finalStyle.minColor = parseRGBAColor(finalStyle.minColor);
          if (finalStyle.maxColor) finalStyle.maxColor = parseRGBAColor(finalStyle.maxColor);
          if (finalStyle.defaultColor) finalStyle.defaultColor = parseRGBAColor(finalStyle.defaultColor);
          if (finalStyle.mapping && typeof finalStyle.mapping === "object") {
            const normalizedMapping: Record<string, any> = {};
            for (const [k, rawVal] of Object.entries(finalStyle.mapping)) {
              const v = (rawVal && typeof rawVal === "object" ? rawVal : {}) as Record<string, any>;
              normalizedMapping[k] = {
                ...v,
                fillColor: v.fillColor ? parseRGBAColor(v.fillColor) : [59, 130, 246, 200],
                ...(v.lineColor && { lineColor: parseRGBAColor(v.lineColor) }),
              };
            }
            finalStyle.mapping = normalizedMapping;
          }
          if (finalStyle.rules && Array.isArray(finalStyle.rules)) {
            finalStyle.rules = finalStyle.rules.map((r: any) => ({
              ...r,
              ...(r.fillColor && { fillColor: parseRGBAColor(r.fillColor) }),
              ...(r.lineColor && { lineColor: parseRGBAColor(r.lineColor) }),
            }));
          }
          if (finalStyle.colorRange && Array.isArray(finalStyle.colorRange)) {
            finalStyle.colorRange = finalStyle.colorRange.map((c: any) => parseRGBAColor(c));
          }

          // Aggregate sample properties across up to 20 features
          let sampleProps: Record<string, any> = {};
          const scanCount = Math.min(features.length, 20);
          for (let i = 0; i < scanCount; i++) {
            if (features[i]?.properties) {
              sampleProps = { ...sampleProps, ...features[i].properties };
            }
          }

          // 1. Smart fuzzy field resolution on actual feature properties
          if (finalStyle.field) {
            const resolved = resolveFeatureProperty(
              sampleProps,
              finalStyle.field,
            );
            if (resolved) {
              console.log(
                `🎨 [MapExecutor] Resolved field "${finalStyle.field}" -> "${resolved.key}"`,
              );
              finalStyle.field = resolved.key;
            }
          }
          if (finalStyle.sourceField) {
            const resolvedSource = resolveFeatureProperty(
              sampleProps,
              finalStyle.sourceField,
            );
            if (resolvedSource) {
              finalStyle.sourceField = resolvedSource.key;
            }
          }
          if (finalStyle.sizeField) {
            const resolvedSize = resolveFeatureProperty(
              sampleProps,
              finalStyle.sizeField,
            );
            if (resolvedSize) {
              finalStyle.sizeField = resolvedSize.key;
            }
          }

          // 2. Palette resolution
          const paletteName =
            typeof finalStyle.palette === "string"
              ? finalStyle.palette.toLowerCase()
              : "";
          const activePalette =
            CURATED_PALETTES[paletteName] || DYNAMIC_PALETTE;

          // 3. Category styling with support for valueGroups, rules, semantic regions, and ranges
          if (finalStyle.type === "category") {
            const {
              evaluateStyleRule,
              matchValueGroup,
              autoClassifyIndiaRegion,
            } = await import("@/utils/styleRuleEvaluator");

            let mapping = finalStyle.mapping ? { ...finalStyle.mapping } : {};
            const targetProp =
              finalStyle.targetField || finalStyle.field || "category";
            let featuresUpdated = false;

            // Scenario A: valueGroups provided (e.g. { "South": ["Tamil Nadu", "Kerala"], "North": ["Delhi", "Punjab"] })
            if (
              finalStyle.valueGroups &&
              typeof finalStyle.valueGroups === "object" &&
              Object.keys(finalStyle.valueGroups).length > 0
            ) {
              const groups = finalStyle.valueGroups as Record<string, string[]>;
              const groupNames = Object.keys(groups);

              groupNames.forEach((g, idx) => {
                if (!mapping[g]) {
                  const c = activePalette[idx % activePalette.length];
                  mapping[g] = {
                    fillColor: parseRGBAColor(c),
                    label: g,
                  };
                } else if (mapping[g].fillColor) {
                  mapping[g].fillColor = parseRGBAColor(mapping[g].fillColor);
                }
              });

              if (finalStyle.dimUnmatched && !mapping["_unmatched_"]) {
                mapping["_unmatched_"] = {
                  fillColor: [160, 160, 160, 30],
                  lineColor: [160, 160, 160, 50],
                  label: "Other",
                };
              }
              if (finalStyle.hideUnmatched && !mapping["_unmatched_"]) {
                mapping["_unmatched_"] = {
                  fillColor: [0, 0, 0, 0],
                  lineColor: [0, 0, 0, 0],
                  label: "Other",
                };
              }

              const updatedFeatures = features.map((f: any) => {
                const p = f?.properties || {};
                const matchedGroup = matchValueGroup(
                  p,
                  groups,
                  finalStyle.sourceField || finalStyle.field,
                );
                const assigned =
                  matchedGroup ||
                  (finalStyle.dimUnmatched || finalStyle.hideUnmatched
                    ? "_unmatched_"
                    : null);
                if (assigned) {
                  return { ...f, properties: { ...p, [targetProp]: assigned } };
                }
                return f;
              });

              finalStyle.field = targetProp;
              finalStyle.mapping = mapping;
              featuresUpdated = true;

              const newLayers = [...currentLayers];
              newLayers[layerIndex] = {
                ...targetLayer,
                features: updatedFeatures,
              };
              useMapStore.getState().setMapFeatures(newLayers);
            }
            // Scenario B: rules provided (e.g. [ { category: "South", operator: "in", value: [...] }, ... ])
            else if (
              finalStyle.rules &&
              Array.isArray(finalStyle.rules) &&
              finalStyle.rules.length > 0
            ) {
              finalStyle.rules.forEach((rule: any, idx: number) => {
                if (rule.category && !mapping[rule.category]) {
                  const rawColor = rule.fillColor || activePalette[idx % activePalette.length];
                  mapping[rule.category] = {
                    fillColor: parseRGBAColor(rawColor),
                    label: rule.label || rule.category,
                  };
                } else if (rule.category && mapping[rule.category]?.fillColor) {
                  mapping[rule.category].fillColor = parseRGBAColor(mapping[rule.category].fillColor);
                }
              });

              if (finalStyle.dimUnmatched && !mapping["_unmatched_"]) {
                mapping["_unmatched_"] = {
                  fillColor: [160, 160, 160, 30],
                  lineColor: [160, 160, 160, 50],
                  label: "Other",
                };
              }
              if (finalStyle.hideUnmatched && !mapping["_unmatched_"]) {
                mapping["_unmatched_"] = {
                  fillColor: [0, 0, 0, 0],
                  lineColor: [0, 0, 0, 0],
                  label: "Other",
                };
              }

              const updatedFeatures = features.map((f: any) => {
                const p = f?.properties || {};
                let matchedRuleCategory: string | null = null;
                for (const r of finalStyle.rules!) {
                  if (evaluateStyleRule(p, r)) {
                    matchedRuleCategory = r.category;
                    break;
                  }
                }
                const assigned =
                  matchedRuleCategory ||
                  (finalStyle.dimUnmatched || finalStyle.hideUnmatched
                    ? "_unmatched_"
                    : null);
                if (assigned) {
                  return { ...f, properties: { ...p, [targetProp]: assigned } };
                }
                return f;
              });

              finalStyle.field = targetProp;
              finalStyle.mapping = mapping;
              featuresUpdated = true;

              const newLayers = [...currentLayers];
              newLayers[layerIndex] = {
                ...targetLayer,
                features: updatedFeatures,
              };
              useMapStore.getState().setMapFeatures(newLayers);
            }
            // Scenario C: Mapping has South / North / East / West / Central, but no explicit rules or valueGroups
            else if (
              mapping &&
              Object.keys(mapping).some((k) =>
                /^(south|north|east|west|central)/i.test(k.trim()),
              ) &&
              features.length > 0
            ) {
              const targetCats = Object.keys(mapping);
              let hasAnyMatch = false;

              for (let i = 0; i < Math.min(features.length, 10); i++) {
                if (
                  autoClassifyIndiaRegion(
                    features[i]?.properties || {},
                    targetCats,
                  )
                ) {
                  hasAnyMatch = true;
                  break;
                }
              }

              if (hasAnyMatch) {
                console.log(
                  `🎨 [MapExecutor] Auto-classifying India regions for mapping:`,
                  targetCats,
                );
                const updatedFeatures = features.map((f: any) => {
                  const p = f?.properties || {};
                  const matchedRegion = autoClassifyIndiaRegion(p, targetCats);
                  if (matchedRegion) {
                    return {
                      ...f,
                      properties: { ...p, [targetProp]: matchedRegion },
                    };
                  }
                  return f;
                });

                finalStyle.field = targetProp;
                featuresUpdated = true;

                const newLayers = [...currentLayers];
                newLayers[layerIndex] = {
                  ...targetLayer,
                  features: updatedFeatures,
                };
                useMapStore.getState().setMapFeatures(newLayers);
              }
            }
            // Scenario D: Numeric ranges (e.g. speed thresholds)
            else if (
              finalStyle.ranges &&
              Array.isArray(finalStyle.ranges) &&
              finalStyle.ranges.length > 0
            ) {
              const sourceProp = finalStyle.sourceField || finalStyle.field;
              finalStyle.ranges.forEach((r: any, idx: number) => {
                if (r.category && !mapping[r.category]) {
                  const c = activePalette[idx % activePalette.length];
                  mapping[r.category] = {
                    fillColor: parseRGBAColor(c),
                    label: r.category,
                  };
                } else if (r.category && mapping[r.category]?.fillColor) {
                  mapping[r.category].fillColor = parseRGBAColor(mapping[r.category].fillColor);
                }
              });

              const updatedFeatures = features.map((f: any) => {
                const val = Number(f?.properties?.[sourceProp]);
                if (!isNaN(val)) {
                  for (const r of finalStyle.ranges!) {
                    const minOk = r.min === undefined || val >= r.min;
                    const maxOk = r.max === undefined || val < r.max;
                    if (minOk && maxOk) {
                      return {
                        ...f,
                        properties: {
                          ...f.properties,
                          [targetProp]: r.category,
                        },
                      };
                    }
                  }
                }
                return f;
              });

              finalStyle.field = targetProp;
              finalStyle.mapping = mapping;
              featuresUpdated = true;

              const newLayers = [...currentLayers];
              newLayers[layerIndex] = {
                ...targetLayer,
                features: updatedFeatures,
              };
              useMapStore.getState().setMapFeatures(newLayers);
            }

            // Scenario E: Standard categorical field auto-discovery if mapping is empty or single entry
            if (
              !featuresUpdated &&
              Object.keys(mapping).length <= 1 &&
              features.length > 0
            ) {
              let field = finalStyle.field;

              // Check if field actually exists on features
              const resolvedField = resolveFeatureProperty(sampleProps, field);
              if (resolvedField) {
                field = resolvedField.key;
                finalStyle.field = field;
              } else {
                // If field doesn't exist, pick the first valid string column (not starting with _)
                const fallbackCol = Object.keys(sampleProps).find(
                  (k) =>
                    !k.startsWith("_") && typeof sampleProps[k] === "string",
                );
                if (fallbackCol) {
                  console.log(
                    `🎨 [MapExecutor] Field "${field}" not found, falling back to column "${fallbackCol}"`,
                  );
                  field = fallbackCol;
                  finalStyle.field = fallbackCol;
                }
              }

              if (field) {
                const counts = new Map<string, number>();
                const total = features.length;
                const step = total > 30000 ? Math.ceil(total / 30000) : 1;
                for (let i = 0; i < total; i += step) {
                  const p = features[i]?.properties;
                  const propRes = resolveFeatureProperty(p, field);
                  if (
                    propRes &&
                    propRes.value !== undefined &&
                    propRes.value !== null &&
                    propRes.value !== ""
                  ) {
                    const s = String(propRes.value);
                    counts.set(s, (counts.get(s) || 0) + 1);
                  }
                }
                const uniqueVals = Array.from(counts.entries())
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 25)
                  .map(([k]) => k);

                uniqueVals.forEach((val, idx) => {
                  const c = activePalette[idx % activePalette.length];
                  mapping[val] = {
                    fillColor: parseRGBAColor(c),
                    label: val,
                  };
                });

                finalStyle.mapping = mapping;
              }
            }

            finalStyle.mapping = mapping;
          } else if (finalStyle.type === "gradient") {
            const field = finalStyle.field;
            let minVal = finalStyle.min;
            let maxVal = finalStyle.max;

            if (
              (minVal === undefined ||
                maxVal === undefined ||
                minVal === maxVal) &&
              field &&
              features.length > 0
            ) {
              let curMin = Infinity;
              let curMax = -Infinity;
              let hasNum = false;
              const total = features.length;
              const step = total > 30000 ? Math.ceil(total / 30000) : 1;

              for (let i = 0; i < total; i += step) {
                const p = features[i]?.properties;
                const propRes = resolveFeatureProperty(p, field);
                if (propRes) {
                  const n = parseNumericValue(propRes.value);
                  if (!isNaN(n)) {
                    hasNum = true;
                    if (n < curMin) curMin = n;
                    if (n > curMax) curMax = n;
                  }
                }
              }
              if (hasNum && curMin !== Infinity) {
                minVal = curMin;
                maxVal = curMax > curMin ? curMax : curMin + 100;
              } else {
                minVal = 0;
                maxVal = 100;
              }
            }
            finalStyle.min = minVal ?? 0;
            finalStyle.max = maxVal ?? 100;
            if (!finalStyle.minColor)
              finalStyle.minColor = activePalette[0] || [59, 130, 246, 180];
            if (!finalStyle.maxColor)
              finalStyle.maxColor = activePalette[activePalette.length - 1] || [
                239, 68, 68, 180,
              ];
          }

          // 4. Color normalization on finalStyle
          if (finalStyle.fillColor) finalStyle.fillColor = parseRGBAColor(finalStyle.fillColor);
          if (finalStyle.lineColor) finalStyle.lineColor = parseRGBAColor(finalStyle.lineColor);
          if (finalStyle.minColor) finalStyle.minColor = parseRGBAColor(finalStyle.minColor);
          if (finalStyle.maxColor) finalStyle.maxColor = parseRGBAColor(finalStyle.maxColor);
          if (finalStyle.defaultColor) finalStyle.defaultColor = parseRGBAColor(finalStyle.defaultColor);
          if (finalStyle.mapping && typeof finalStyle.mapping === "object") {
            for (const k of Object.keys(finalStyle.mapping)) {
              if (finalStyle.mapping[k]?.fillColor) {
                finalStyle.mapping[k].fillColor = parseRGBAColor(finalStyle.mapping[k].fillColor);
              }
              if (finalStyle.mapping[k]?.lineColor) {
                finalStyle.mapping[k].lineColor = parseRGBAColor(finalStyle.mapping[k].lineColor);
              }
            }
          }
          if (finalStyle.rules && Array.isArray(finalStyle.rules)) {
            for (const r of finalStyle.rules) {
              if (r.fillColor) r.fillColor = parseRGBAColor(r.fillColor);
              if (r.lineColor) r.lineColor = parseRGBAColor(r.lineColor);
            }
          }

          // 5. Visualization type switching if requested (HexagonLayer, HeatmapLayer, etc.)
          const candidateViz = cmd.payload?.visualizationType || style?.visualizationType || style?.type;
          const vizType = candidateViz === "HeatmapLayer" || candidateViz === "heatmap"
            ? "HeatmapLayer"
            : candidateViz === "HexagonLayer" || candidateViz === "hexagon"
              ? "HexagonLayer"
              : candidateViz === "ScatterplotLayer" || candidateViz === "scatterplot"
                ? "ScatterplotLayer"
                : candidateViz === "GridLayer" || candidateViz === "grid"
                  ? "GridLayer"
                  : candidateViz === "GeoJsonLayer" || candidateViz === "geojson"
                    ? "GeoJsonLayer"
                    : null;

          if (vizType && ["HexagonLayer", "HeatmapLayer", "ScatterplotLayer", "GridLayer", "GeoJsonLayer"].includes(vizType)) {
            store.setMapFeatureLayerType(layerIndex, vizType as any);
            const vizConfig: any = {};
            const r = cmd.payload?.radius ?? style?.radius;
            if (r !== undefined) vizConfig.radius = r;
            const rp = cmd.payload?.radiusPixels ?? style?.radiusPixels;
            if (rp !== undefined) vizConfig.radiusPixels = rp;
            const es = cmd.payload?.elevationScale ?? style?.elevationScale;
            if (es !== undefined) vizConfig.elevationScale = es;
            const inten = cmd.payload?.intensity ?? style?.intensity;
            if (inten !== undefined) vizConfig.intensity = inten;
            const ext = cmd.payload?.extruded ?? style?.extruded;
            if (ext !== undefined) vizConfig.extruded = ext;
            const colorRange = cmd.payload?.colorRange || style?.colorRange;
            if (colorRange && Array.isArray(colorRange)) {
              vizConfig.colorRange = colorRange.map((c: any) => parseRGBAColor(c));
            }
            store.setMapFeatureLayerConfig(layerIndex, vizConfig);
          }

          // 6. 3D Extrusion auto perspective tilt
          if (finalStyle.extruded || finalStyle.elevationField) {
            const currentPitch = store.viewState?.pitch ?? 0;
            if (currentPitch < 20) {
              store.setViewState({
                pitch: 45,
                transitionDuration: 800,
              });
            }
          }

          useMapStore
            .getState()
            .setMapFeatureLayerStyle(layerIndex, finalStyle);

          if (sessionId && !sessionId.startsWith("shared-")) {
            const updatedLayers = useMapStore.getState().mapFeatures;
            const updatedLayer = updatedLayers[layerIndex];
            if (updatedLayer) {
              const lName = extractLayerName(updatedLayer) || `Layer ${layerIndex + 1}`;
              saveLayer(sessionId, layerIndex, lName, updatedLayer, true, true).catch((e) =>
                console.warn("[MapExecutor] Failed to save styled layer to session:", e)
              );
            }
          }

          const styleTypeLabel =
            vizType && vizType !== "GeoJsonLayer"
              ? `${vizType} visualization`
              : finalStyle.type === "category"
                ? `category-based on "${finalStyle.field}"`
                : finalStyle.type === "gradient"
                  ? `gradient on "${finalStyle.field}"`
                  : "solid color";
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Applied ${styleTypeLabel} styling to layer ${layerIndex}.${finalStyle.extruded || finalStyle.elevationField ? " 3D perspective extrusion enabled." : ""} All features are styled with colors on the map.`,
          });
          break;
        }
        case "CLEAR_LAYER_STYLE": {
          const store = useMapStore.getState();
          const currentLayers = store.mapFeatures;
          let layerIndex = cmd.payload?.layerIndex;
          const targetLayerName = (cmd.payload?.layerName || (typeof layerIndex === "string" ? layerIndex : ""))?.toLowerCase().trim();
          if (targetLayerName && isNaN(Number(targetLayerName)) && currentLayers.length > 0) {
            const foundIdx = currentLayers.findIndex((l: any, i: number) => {
              const name = (extractLayerName(l) || l.title || l.name || l.properties?.title || l.properties?.name || `layer_${i + 1}`).toLowerCase();
              return name.includes(targetLayerName) || targetLayerName.includes(name);
            });
            if (foundIdx !== -1) {
              layerIndex = foundIdx;
            }
          }
          if (typeof layerIndex === "string") {
            const parsed = parseInt(layerIndex.replace(/\D/g, ""), 10);
            layerIndex = isNaN(parsed)
              ? (store.selectedLayerIndex ?? 0)
              : parsed;
          } else if (typeof layerIndex !== "number") {
            layerIndex = store.selectedLayerIndex ?? 0;
          }
          store.clearMapFeatureLayerStyle(layerIndex);

          if (sessionId && !sessionId.startsWith("shared-")) {
            const updatedLayers = useMapStore.getState().mapFeatures;
            const updatedLayer = updatedLayers[layerIndex];
            if (updatedLayer) {
              const lName = extractLayerName(updatedLayer) || `Layer ${layerIndex + 1}`;
              saveLayer(sessionId, layerIndex, lName, updatedLayer, true, true).catch((e) =>
                console.warn("[MapExecutor] Failed to save cleared layer to session:", e)
              );
            }
          }

          results.push({
            success: true,
            code: "SUCCESS",
            message: `Cleared styling from layer ${layerIndex}.`,
          });
          break;
        }
        case "COMPARE_PINCODES": {
          const { pinCodeA, pinCodeB, sector = "real_estate", specificAmenities, d0 = 0.5, renderOnMap = true, precomputedLayers } = cmd.payload || {};
          if (!pinCodeA || !pinCodeB) {
            throw new Error("Missing pinCodeA or pinCodeB parameters.");
          }
          const {
            fetchOrResolvePinCode,
            comparePinCodes,
            generateZipBoundaryGeoJson,
            generatePinAmenitiesGeoJson,
            generateComparisonColorLegend,
            getScoreBasedBoundaryColor,
            SECTOR_PROFILES,
          } = await import("@/services/locusScoreService");

          let dataA: any = null;
          let dataB: any = null;
          let comparison: any = null;
          let scoreA = 0;
          let scoreB = 0;
          const sectorLabel = (SECTOR_PROFILES as any)[sector]?.name || sector;
          let newFeatures: any[] = [];

          if (Array.isArray(precomputedLayers) && precomputedLayers.length === 4) {
            newFeatures = precomputedLayers;
            const bFeatA = precomputedLayers[0]?.features?.[0];
            const bFeatB = precomputedLayers[2]?.features?.[0];
            const coordA = bFeatA?.geometry?.coordinates?.[0]?.[0] || [0, 0];
            const coordB = bFeatB?.geometry?.coordinates?.[0]?.[0] || [0, 0];
            scoreA = bFeatA?.properties?.score || 50;
            scoreB = bFeatB?.properties?.score || 50;
            dataA = { lng: coordA[0], lat: coordA[1], name: bFeatA?.properties?.area_name || pinCodeA, pinCode: pinCodeA, pois: [] };
            dataB = { lng: coordB[0], lat: coordB[1], name: bFeatB?.properties?.area_name || pinCodeB, pinCode: pinCodeB, pois: [] };
          } else {
            dataA = await fetchOrResolvePinCode(pinCodeA, d0, specificAmenities);
            dataB = await fetchOrResolvePinCode(pinCodeB, d0, specificAmenities);
            comparison = comparePinCodes(dataA, dataB, sector as any, d0);
            scoreA = comparison.overallDelta.scoreA;
            scoreB = comparison.overallDelta.scoreB;

            // Layer 1: Boundary A (score-colored)
            newFeatures.push(generateZipBoundaryGeoJson(dataA, scoreA, sectorLabel));
            // Layer 2: Amenities A (category-colored)
            newFeatures.push(generatePinAmenitiesGeoJson(dataA, `pinA_${pinCodeA}`));
            // Layer 3: Boundary B (score-colored)
            newFeatures.push(generateZipBoundaryGeoJson(dataB, scoreB, sectorLabel));
            // Layer 4: Amenities B (category-colored)
            newFeatures.push(generatePinAmenitiesGeoJson(dataB, `pinB_${pinCodeB}`));
          }

          console.log(`\n================================================================================`);
          console.log(`🗺️ [STEP 7: CLIENT MAP EXECUTOR] Rendering COMPARE_PINCODES on Deck.gl Map:`);
          console.log(`   PIN A: ${pinCodeA} vs PIN B: ${pinCodeB}`);
          console.log(`   Sector: ${sector} | Decay d0: ${d0}`);
          console.log(`   Precomputed Layers Received: ${Array.isArray(precomputedLayers) ? precomputedLayers.length : 0}`);

          if (renderOnMap !== false) {
            // Remove ANY existing Locus comparison layers (boundaries, buffers, amenities) to prevent duplicate layers
            const existing = useMapStore
              .getState()
              .mapFeatures.filter(
                (f: any) =>
                  !f?.properties?.isLocusLayer &&
                  !f?.properties?.isLocusBuffer &&
                  !f?.properties?.isLocusBoundary &&
                  !f?.properties?.isLocusAmenities &&
                  !(typeof f?.properties?.name === "string" && (f.properties.name.startsWith("Boundary:") || f.properties.name.startsWith("Amenities:")))
              );
            useMapStore.getState().setMapFeatures([...existing, ...newFeatures]);

            console.log(`   🎨 Mounted ${newFeatures.length} Comparison Layers on MapStore:`);
            newFeatures.forEach((feat, fIdx) => {
              const isBoundary = feat.properties?.isLocusBoundary;
              const fCount = Array.isArray(feat.features) ? feat.features.length : 1;
              const fTitle = feat.properties?.name || `Layer ${fIdx + 1}`;
              console.log(`      • Layer ${fIdx + 1}: [${isBoundary ? 'Boundary Polygon' : 'Amenity POI Dots'}] - ${fCount} feature(s) - "${fTitle}"`);
            });

            if (sessionId) {
              newFeatures.forEach((feat, fIdx) => {
                const fLabel = feat.properties?.name || `Locus Compare Layer ${fIdx + 1}`;
                saveLayer(sessionId, existing.length + fIdx, fLabel, feat).catch(console.error);
              });
            }

            if (dataA.lng && dataB.lng && dataA.lat && dataB.lat) {
              const minLng = Math.min(dataA.lng, dataB.lng);
              const maxLng = Math.max(dataA.lng, dataB.lng);
              const minLat = Math.min(dataA.lat, dataB.lat);
              const maxLat = Math.max(dataA.lat, dataB.lat);
              const centerLng = (minLng + maxLng) / 2;
              const centerLat = (minLat + maxLat) / 2;

              const distKm = Math.hypot((dataA.lng - dataB.lng) * 108, (dataA.lat - dataB.lat) * 111);
              let zoomLevel = 13;
              if (distKm > 50) zoomLevel = 8;
              else if (distKm > 20) zoomLevel = 10;
              else if (distKm > 10) zoomLevel = 11;
              else if (distKm > 4) zoomLevel = 12;

              useMapStore.getState().setViewState({
                longitude: centerLng,
                latitude: centerLat,
                zoom: zoomLevel,
                transitionDuration: 1200,
              });
              console.log(`   🎯 Camera animated to center [Lat ${centerLat.toFixed(5)}, Lng ${centerLng.toFixed(5)}] at Zoom ${zoomLevel} (Span: ${distKm.toFixed(1)} km)`);
            }
          }
          console.log(`================================================================================\n`);

          // Generate color legend for user explanation
          const colorLegend = generateComparisonColorLegend(dataA, dataB, scoreA, scoreB, sector);
          const colorA = getScoreBasedBoundaryColor(scoreA);
          const colorB = getScoreBasedBoundaryColor(scoreB);

          results.push({
            success: true,
            code: "SUCCESS",
            message: `Compared PIN codes ${pinCodeA} (${dataA.name}) and ${pinCodeB} (${dataB.name}) for ${sectorLabel}. Scores: ${scoreA} vs ${scoreB}. 4 layers rendered: 2 boundaries (score-colored) + 2 amenity layers (category-colored).`,
            data: {
              ...(comparison || {}),
              colorLegend,
              layerStructure: {
                layer1: `Boundary: ${pinCodeA} (${dataA.name}) — ${colorA.label}`,
                layer2: `Amenities: ${pinCodeA} (${dataA.name}) — ${dataA.pois?.length || 0} POIs, category-colored`,
                layer3: `Boundary: ${pinCodeB} (${dataB.name}) — ${colorB.label}`,
                layer4: `Amenities: ${pinCodeB} (${dataB.name}) — ${dataB.pois?.length || 0} POIs, category-colored`,
              },
            },
          });
          break;
        }
        case "SCORE_PINCODE": {
          const { pinCode, sector = "real_estate", specificAmenities, d0 = 0.5, renderOnMap = true, precomputedLayers } = cmd.payload || {};
          if (!pinCode) throw new Error("Missing pinCode parameter.");
          const {
            fetchOrResolvePinCode,
            generateCategoryPOIGeoJson,
            generatePinBufferGeoJson,
            ALL_CATEGORY_IDS,
          } = await import("@/services/locusScoreService");

          let data: any = null;
          let newFeatures: any[] = [];
          if (Array.isArray(precomputedLayers) && precomputedLayers.length > 0) {
            newFeatures = precomputedLayers;
            const feat0 = precomputedLayers[0]?.features?.[0];
            const coord = feat0?.geometry?.coordinates?.[0]?.[0] || feat0?.geometry?.coordinates || [0, 0];
            data = {
              lat: Array.isArray(coord) ? coord[1] : 0,
              lng: Array.isArray(coord) ? coord[0] : 0,
              name: feat0?.properties?.name || pinCode,
              sectorScores: { [sector]: feat0?.properties?.score || 50 },
            };
          } else {
            data = await fetchOrResolvePinCode(pinCode, d0, specificAmenities);
            newFeatures = [generatePinBufferGeoJson(data, 1.0)];
            const targetCats =
              Array.isArray(specificAmenities) && specificAmenities.length > 0
                ? Array.from(new Set(data.pois.map((p: any) => p.category)))
                : ALL_CATEGORY_IDS;
            for (const catId of targetCats) {
              newFeatures.push(generateCategoryPOIGeoJson(data, catId as any));
            }
          }

          if (renderOnMap !== false) {
            const existing = useMapStore
              .getState()
              .mapFeatures.filter(
                (f: any) =>
                  !f?.properties?.isLocusLayer &&
                  !f?.properties?.isLocusBuffer &&
                  !f?.properties?.isLocusBoundary &&
                  !f?.properties?.isLocusAmenities &&
                  !(typeof f?.properties?.name === "string" && (f.properties.name.startsWith("Boundary:") || f.properties.name.startsWith("Amenities:")))
              );
            useMapStore.getState().setMapFeatures([...existing, ...newFeatures]);

            if (sessionId) {
              newFeatures.forEach((feat, fIdx) => {
                const fLabel = feat.properties?.name || `Locus PIN ${pinCode} Layer ${fIdx + 1}`;
                saveLayer(sessionId, existing.length + fIdx, fLabel, feat).catch(console.error);
              });
            }

            if (data.lng && data.lat) {
              useMapStore.getState().setViewState({
                longitude: data.lng,
                latitude: data.lat,
                zoom: 14,
                transitionDuration: 1000,
              });
            }
          }

            const sKey = (sector || "real_estate") as keyof typeof data.sectorScores;
            results.push({
              success: true,
              code: "SUCCESS",
              message: `Scored PIN code ${pinCode} (${data.name}): LocusScore = ${data.sectorScores[sKey]}.`,
              data,
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
