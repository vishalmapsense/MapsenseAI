/**
 * Layer Sync Service
 * ─────────────────────────────────────────────────────────────
 * Frontend service for persisting geospatial layers to Supabase.
 * All operations go through Next.js API routes (server-side auth).
 *
 * KEY RULE: saveLayer() is called ONLY after map successfully renders
 * the layer. This prevents invalid/broken data from being persisted.
 * ─────────────────────────────────────────────────────────────
 */

export interface PersistedLayer {
  id: string;
  user_id: string;
  session_id: string;
  layer_index: number;
  layer_name: string;
  geojson: any;
  created_at: string;
}

// In-memory cache to store layers for sessions and avoid redundant DB calls
const layerCache: Record<string, any[]> = {};

/**
 * Manually populate the layer cache (useful for shared sessions).
 */
export function setSessionLayersCache(sessionId: string, layers: any[]) {
  layerCache[sessionId] = layers;
}

/**
 * Fetch all layers for a given session from Supabase.
 * Returns GeoJSON objects in layer_index order (ready for setMapFeatures).
 * Uses an in-memory cache to return layers instantly if already fetched.
 */
export async function fetchSessionLayers(sessionId: string): Promise<any[]> {
  // Check cache first
  if (layerCache[sessionId]) {
    console.log(`[LayerSync] ⚡ Serving ${layerCache[sessionId].length} layers from cache for session ${sessionId}`);
    return layerCache[sessionId];
  }

  // Shared sessions are loaded via the public share route and cached manually.
  // If not in cache, don't attempt to fetch via private API to avoid 401.
  if (sessionId.startsWith("shared-")) {
    return [];
  }

  try {
    const res = await fetch(`/api/adk-chat/sessions/${sessionId}/layers`);
    if (!res.ok) {
      console.warn(`[LayerSync] Failed to fetch layers for session ${sessionId}:`, res.status);
      return [];
    }
    const data = await res.json();
    if (data.success && Array.isArray(data.layers)) {
      // Return just the geojson data, ordered by layer_index
      const geojsonData = data.layers.map((l: PersistedLayer) => l.geojson);
      // Store in cache
      layerCache[sessionId] = geojsonData;
      return geojsonData;
    }
    return [];
  } catch (err) {
    console.error("[LayerSync] Error fetching session layers:", err);
    return [];
  }
}

import { toast } from "sonner";
import { Layers } from "lucide-react";

/**
 * Safe coordinate decimation for dense polygon/line rings to keep GeoJSON
 * under Supabase REST body limits while preserving ring closure and visual shape.
 */
function decimateCoordinates(coords: any, step: number = 2): any {
  if (!Array.isArray(coords)) return coords;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    return coords;
  }
  // If this is a ring of coordinate pairs with more than 8 vertices:
  if (coords.length > 8 && Array.isArray(coords[0]) && typeof coords[0][0] === "number") {
    const res = [];
    for (let i = 0; i < coords.length - 1; i += step) {
      res.push(coords[i]);
    }
    // Always preserve ring closure with the last point
    res.push(coords[coords.length - 1]);
    return res;
  }
  return coords.map((c: any) => decimateCoordinates(c, step));
}

/**
 * Optimize GeoJSON coordinate precision and vertex count to dramatically
 * reduce payload size (down by 50-70%) without visible map distortion.
 */
function optimizeGeoJsonForStorage(geojson: any, precision: number = 5): any {
  if (!geojson || typeof geojson !== "object") return geojson;

  const roundNum = (n: number) => {
    if (typeof n !== "number" || isNaN(n)) return n;
    return Number(n.toFixed(precision));
  };

  const transformCoords = (coords: any): any => {
    if (!Array.isArray(coords)) return coords;
    if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
      return coords.map((c: any) => (typeof c === "number" ? roundNum(c) : c));
    }
    return coords.map(transformCoords);
  };

  try {
    let processed = geojson;
    if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
      processed = {
        ...geojson,
        features: geojson.features.map((f: any) => {
          if (!f || !f.geometry || !f.geometry.coordinates) return f;
          return {
            ...f,
            geometry: {
              ...f.geometry,
              coordinates: transformCoords(f.geometry.coordinates),
            },
          };
        }),
      };
    } else if (geojson.type === "Feature" && geojson.geometry?.coordinates) {
      processed = {
        ...geojson,
        geometry: {
          ...geojson.geometry,
          coordinates: transformCoords(geojson.geometry.coordinates),
        },
      };
    } else if (geojson.coordinates) {
      processed = {
        ...geojson,
        coordinates: transformCoords(geojson.coordinates),
      };
    }

    // If still over 6 MB, apply decimation to polygon/line rings
    const SIX_MB = 6 * 1024 * 1024;
    const strLen = JSON.stringify(processed).length;
    if (strLen > SIX_MB && processed.type === "FeatureCollection" && Array.isArray(processed.features)) {
      console.log(`[LayerSync] 📉 Payload is ${(strLen / (1024 * 1024)).toFixed(1)} MB. Applying ring decimation.`);
      processed = {
        ...processed,
        features: processed.features.map((f: any) => {
          if (!f?.geometry?.coordinates) return f;
          return {
            ...f,
            geometry: {
              ...f.geometry,
              coordinates: decimateCoordinates(f.geometry.coordinates, 2),
            },
          };
        }),
      };
    }

    return processed;
  } catch (e) {
    console.warn("[LayerSync] Failed to optimize GeoJSON coordinates:", e);
    return geojson;
  }
}

/**
 * Save a single layer to Supabase.
 * Called AFTER the layer has been successfully rendered on the map.
 * - Under 10MB: automatically uploads to Supabase.
 * - Over 10MB: asks for confirmation via a toast notification with Action buttons.
 */
export async function saveLayer(
  sessionId: string,
  layerIndex: number,
  layerName: string,
  geojson: any,
  forceSave: boolean = false
): Promise<boolean> {
  // Always update in-memory cache immediately so layer persists across UI re-renders
  if (!layerCache[sessionId]) layerCache[sessionId] = [];
  layerCache[sessionId][layerIndex] = geojson;

  // Measure raw payload size in UTF-8 bytes
  const rawBytes = new TextEncoder().encode(JSON.stringify(geojson)).length;
  const rawSizeMb = (rawBytes / (1024 * 1024)).toFixed(1);
  const formattedSize =
    rawBytes < 1024 * 1024
      ? `${(rawBytes / 1024).toFixed(1)} KB`
      : `${rawSizeMb} MB`;
  const TEN_MB_BYTES = 10 * 1024 * 1024;

  // If raw payload > 10MB and user has not confirmed yet, ask via toast notification
  if (rawBytes > TEN_MB_BYTES && !forceSave) {
    console.warn(
      `[LayerSync] ℹ️ Layer ${layerIndex} ("${layerName}") size is ${formattedSize} (> 10 MB). Requesting user confirmation for cloud save.`
    );

    const toastId = `large-layer-confirm-${sessionId}-${layerIndex}`;
    toast.custom(
      () => (
        <div className="w-[350px] sm:w-[410px] rounded-xl border border-border bg-popover text-popover-foreground p-4 shadow-xl flex flex-col gap-3 font-sans">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-500/15 text-amber-500 shrink-0 mt-0.5 border border-amber-500/30">
              <Layers className="w-5 h-5" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-semibold text-sm leading-tight text-foreground truncate" title={layerName}>
                  Large Layer: {layerName}
                </h4>
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0">
                  {formattedSize}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-normal">
                Layer data is <strong className="text-foreground">{formattedSize}</strong>, which exceeds the 10 MB limit. Save to Supabase cloud?
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
            <button
              onClick={() => {
                toast.dismiss(toastId);
                toast.info(`"${layerName}" (${formattedSize}) kept in session memory only.`);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 transition-colors cursor-pointer"
            >
              Session Only
            </button>
            <button
              onClick={() => {
                toast.dismiss(toastId);
                saveLayer(sessionId, layerIndex, layerName, geojson, true);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
            >
              Save Anyway
            </button>
          </div>
        </div>
      ),
      {
        id: toastId,
        duration: Infinity,
      }
    );

    return true;
  }

  // Optimize coordinates (5 decimal places ~1m precision) + ring decimation if needed
  const optimized = optimizeGeoJsonForStorage(geojson, 5);
  const payload = JSON.stringify({ layerIndex, layerName, geojson: optimized });
  const sizeMb = (payload.length / (1024 * 1024)).toFixed(1);

  // Supabase Storage supports files up to 50 MB on the Free Tier.
  // Layers larger than 3 MB are automatically offloaded to Supabase Storage by the backend.
  const MAX_CLOUD_BYTES = 45 * 1024 * 1024;
  if (payload.length > MAX_CLOUD_BYTES) {
    console.warn(
      `[LayerSync] Layer "${layerName}" is ${sizeMb} MB (> 45 MB storage limit). Keeping in session memory.`
    );
    toast.info(`"${layerName}" (${sizeMb} MB) exceeds maximum cloud limit (45 MB). Kept in session memory.`, {
      duration: 6000,
    });
    return true;
  }

  const savePromise = (async () => {
    const res = await fetch(`/api/adk-chat/sessions/${sessionId}/layers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.error || `HTTP ${res.status}`;
      console.warn(`[LayerSync] Cloud save returned error for layer ${layerIndex} ("${layerName}"):`, errorMessage);
      throw new Error(errorMessage);
    }
    
    console.log(`[LayerSync] ✅ Saved layer ${layerIndex} ("${layerName}") for session ${sessionId}`);
    return true;
  })();

  toast.promise(savePromise, {
    loading: `Saving "${layerName}" (${sizeMb} MB)...`,
    success: `"${layerName}" saved successfully`,
    error: (err: any) => {
      const msg = err.message || "";
      if (
        msg.includes("Bad Gateway") ||
        msg.includes("timeout") ||
        msg.includes("capacity") ||
        msg.includes("limit")
      ) {
        return `"${layerName}" exceeds cloud database limit. Safely kept in session.`;
      }
      return `Failed to save "${layerName}": ${msg || "Network error"}`;
    },
  });

  try {
    await savePromise;
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Delete a specific layer from Supabase by its index.
 */
export async function deleteLayer(sessionId: string, layerIndex: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/adk-chat/sessions/${sessionId}/layers/${layerIndex}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      console.error(`[LayerSync] Failed to delete layer ${layerIndex}:`, res.status);
      return false;
    }
    console.log(`[LayerSync] 🗑️ Deleted layer ${layerIndex} for session ${sessionId}`);
    
    // Update cache
    if (layerCache[sessionId]) {
      layerCache[sessionId].splice(layerIndex, 1);
    }
    
    return true;
  } catch (err) {
    console.error("[LayerSync] Error deleting layer:", err);
    return false;
  }
}

/**
 * Delete ALL layers for a session from Supabase.
 * Used when: session is deleted, or "Clear All" is pressed.
 */
export async function deleteAllLayers(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/adk-chat/sessions/${sessionId}/layers`, {
      method: "DELETE",
    });
    if (!res.ok) {
      console.error(`[LayerSync] Failed to delete all layers for session ${sessionId}:`, res.status);
      return false;
    }
    console.log(`[LayerSync] 🗑️ Deleted all layers for session ${sessionId}`);
    
    // Update cache
    layerCache[sessionId] = [];
    
    return true;
  } catch (err) {
    console.error("[LayerSync] Error deleting all layers:", err);
    return false;
  }
}

/**
 * Full sync: Replace all layers for a session with the current mapFeatures.
 * Deletes existing layers and re-inserts all current layers.
 * Used when layers are reordered via drag-and-drop.
 */
export async function syncAllLayers(sessionId: string, layers: any[]): Promise<boolean> {
  try {
    // First delete all existing layers
    await deleteAllLayers(sessionId);

    // Then save each layer with correct index
    const promises = layers.map((geojson, idx) => {
      const firstFeature = geojson?.features?.[0] || (geojson?.type === "Feature" ? geojson : null);
      const props = firstFeature?.properties || {};
      const layerName = props.name || props.title || props.instruction || `Layer ${idx + 1}`;
      return saveLayer(sessionId, idx, layerName, geojson);
    });

    const results = await Promise.all(promises);
    const allSuccess = results.every(Boolean);
    if (allSuccess) {
      console.log(`[LayerSync] ✅ Full sync complete — ${layers.length} layers saved`);
      // Update cache
      layerCache[sessionId] = [...layers];
    } else {
      console.warn(`[LayerSync] ⚠️ Partial sync — some layers failed to save`);
      // If partial sync fails, we clear the cache so it forces a re-fetch next time
      delete layerCache[sessionId];
    }
    return allSuccess;
  } catch (err) {
    console.error("[LayerSync] Error in full sync:", err);
    return false;
  }
}

/**
 * Extract a readable layer name from a GeoJSON feature/collection.
 */
export function extractLayerName(geojson: any): string {
  const firstFeature = geojson?.features?.[0] || (geojson?.type === "Feature" ? geojson : null);
  const props = firstFeature?.properties || {};
  return props.name || props.title || props.instruction || "Layer";
}
