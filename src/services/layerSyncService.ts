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

/**
 * Save a single layer to Supabase.
 * Called AFTER the layer has been successfully rendered on the map.
 */
export async function saveLayer(
  sessionId: string,
  layerIndex: number,
  layerName: string,
  geojson: any
): Promise<boolean> {
  const savePromise = (async () => {
    const res = await fetch(`/api/adk-chat/sessions/${sessionId}/layers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layerIndex, layerName, geojson }),
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.error || `HTTP ${res.status}`;
      console.error(`[LayerSync] Failed to save layer ${layerIndex} for session ${sessionId}:`, errorMessage);
      throw new Error(errorMessage);
    }
    
    console.log(`[LayerSync] ✅ Saved layer ${layerIndex} ("${layerName}") for session ${sessionId}`);
    
    // Update cache
    if (!layerCache[sessionId]) layerCache[sessionId] = [];
    layerCache[sessionId][layerIndex] = geojson;
    
    return true;
  })();

  toast.promise(savePromise, {
    loading: "Saving layer to database...",
    success: "Layer saved successfully",
    error: (err: any) => `Failed to save layer: ${err.message || "Network error"}`,
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
