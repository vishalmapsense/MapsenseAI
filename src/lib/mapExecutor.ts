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
import {
  resolveFeatureProperty,
  parseNumericValue,
  hashStringToColor,
  DYNAMIC_PALETTE,
  CURATED_PALETTES,
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
          const queryText = cmd.payload?.queryText;
          if (!queryText || typeof queryText !== "string") {
            throw new Error(
              "Missing queryText parameter for client DuckDB query.",
            );
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

          const mapFeatures = useMapStore.getState().mapFeatures;
          await clientDuckDB.syncMapLayers(mapFeatures);

          const queryResult = await clientDuckDB.runQuery(queryText);

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
                    fillColor: [c[0], c[1], c[2], c[3]],
                    label: g,
                  };
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
                  const c =
                    rule.fillColor || activePalette[idx % activePalette.length];
                  mapping[rule.category] = {
                    fillColor: [c[0], c[1], c[2], c[3] ?? 200],
                    label: rule.label || rule.category,
                  };
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
                    fillColor: [c[0], c[1], c[2], c[3]],
                    label: r.category,
                  };
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
                    fillColor: [c[0], c[1], c[2], c[3]],
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

          useMapStore
            .getState()
            .setMapFeatureLayerStyle(layerIndex, finalStyle);

          const styleTypeLabel =
            finalStyle.type === "category"
              ? `category-based on "${finalStyle.field}"`
              : finalStyle.type === "gradient"
                ? `gradient on "${finalStyle.field}"`
                : "solid color";
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Applied ${styleTypeLabel} styling to layer ${layerIndex}. All features are styled with colors on the map.`,
          });
          break;
        }
        case "CLEAR_LAYER_STYLE": {
          let layerIndex = cmd.payload?.layerIndex;
          if (typeof layerIndex === "string") {
            const parsed = parseInt(layerIndex.replace(/\D/g, ""), 10);
            layerIndex = isNaN(parsed)
              ? (useMapStore.getState().selectedLayerIndex ?? 0)
              : parsed;
          } else if (typeof layerIndex !== "number") {
            layerIndex = useMapStore.getState().selectedLayerIndex ?? 0;
          }
          useMapStore.getState().clearMapFeatureLayerStyle(layerIndex);
          results.push({
            success: true,
            code: "SUCCESS",
            message: `Cleared styling from layer ${layerIndex}.`,
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
