/**
 * GeoJSON Resource Store
 * ─────────────────────────────────────────────────────────────
 * MCP Resource mechanism ka implementation.
 *
 * Problem: Large GeoJSON (100KB–1MB+) ko LLM context mein dena
 * impossible hai — context limit hit hoti hai.
 *
 * Solution:
 *   1. Tool result aaya → size check karo
 *   2. Agar ≥ LARGE_PAYLOAD_THRESHOLD → store karo, URI return karo
 *   3. LLM ko sirf URI milti hai (tiny string, e.g. geojson://resource/abc123)
 *   4. Backend post-processing mein URI → actual GeoJSON resolve karta hai
 *   5. Frontend ko full GeoJSON milta hai — LLM ne kabhi dekha hi nahi
 *
 * Memory Management:
 *   - TTL: 5 minutes (requests ke beech data stale ho jaata hai)
 *   - Cleanup: har store operation pe expired entries remove hoti hain
 * ─────────────────────────────────────────────────────────────
 */

import { randomUUID } from "crypto";

// ─── Constants ────────────────────────────────────────────────

/** Bytes mein threshold — is se bada GeoJSON resource store mein jaata hai */
export const LARGE_PAYLOAD_THRESHOLD_BYTES = 1024; // 1 KB (Lowered for testing)

/** Resource URI prefix — MCP resource scheme */
const RESOURCE_URI_PREFIX = "geojson://resource/";

/** Time-to-live for stored resources (milliseconds) */
const RESOURCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Types ────────────────────────────────────────────────────

interface StoredResource {
  uri: string;
  data: unknown;
  storedAt: number;
  sizeBytes: number;
}

// ─── In-Memory Store ──────────────────────────────────────────

/**
 * Next.js server-side module-level singleton.
 * Ek hi process mein sab requests share karta hai.
 * Production mein Redis se replace kar sakte hain.
 */
const resourceStore = new Map<string, StoredResource>();

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Expired entries clean karo (TTL ke baad).
 * Har store operation pe call hota hai.
 */
function evictExpired(): void {
  const now = Date.now();
  for (const [id, resource] of resourceStore.entries()) {
    if (now - resource.storedAt > RESOURCE_TTL_MS) {
      resourceStore.delete(id);
      console.log(`[GeoJSON Resource Store] Evicted expired resource: ${resource.uri}`);
    }
  }
}

/**
 * Kisi bhi value ka approximate byte size calculate karo.
 * JSON.stringify se accurate estimate milta hai.
 */
export function estimateSizeBytes(data: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(data), "utf8");
  } catch {
    return 0;
  }
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Check karo ki ye value large threshold cross kar rahi hai ya nahi.
 * Agar haan, to resource store mein daalna chahiye.
 */
export function isLargePayload(data: unknown): boolean {
  return estimateSizeBytes(data) >= LARGE_PAYLOAD_THRESHOLD_BYTES;
}

/**
 * Check karo ki string ek valid resource URI hai.
 *
 * @example
 * isResourceURI("geojson://resource/abc123") // → true
 * isResourceURI("{type: 'FeatureCollection'}") // → false
 */
export function isResourceURI(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(RESOURCE_URI_PREFIX);
}

/**
 * GeoJSON data store karo aur ek opaque resource URI return karo.
 * LLM ko ye URI milti hai — actual data nahi.
 *
 * @param data - GeoJSON FeatureCollection ya Feature
 * @returns resource URI, e.g. "geojson://resource/550e8400-e29b-41d4-a716-446655440000"
 */
export function storeGeoJSON(data: unknown): string {
  evictExpired();

  const id = randomUUID();
  const uri = `${RESOURCE_URI_PREFIX}${id}`;
  const sizeBytes = estimateSizeBytes(data);

  resourceStore.set(id, {
    uri,
    data,
    storedAt: Date.now(),
    sizeBytes,
  });

  const sizeKB = (sizeBytes / 1024).toFixed(1);
  console.log(`[GeoJSON Resource Store] Stored resource: ${uri} (${sizeKB} KB)`);

  return uri;
}

/**
 * Resource URI se actual GeoJSON data fetch karo.
 *
 * @param uri - Resource URI (e.g. "geojson://resource/abc123")
 * @returns stored GeoJSON data, ya null agar URI invalid/expired hai
 */
export function readGeoJSON(uri: string): unknown | null {
  if (!isResourceURI(uri)) return null;

  const id = uri.replace(RESOURCE_URI_PREFIX, "");
  const resource = resourceStore.get(id);

  if (!resource) {
    console.warn(`[GeoJSON Resource Store] Resource not found or expired: ${uri}`);
    return null;
  }

  // TTL check
  if (Date.now() - resource.storedAt > RESOURCE_TTL_MS) {
    resourceStore.delete(id);
    console.warn(`[GeoJSON Resource Store] Resource expired: ${uri}`);
    return null;
  }

  console.log(`[GeoJSON Resource Store] Read resource: ${uri} (${(resource.sizeBytes / 1024).toFixed(1)} KB)`);
  return resource.data;
}

/**
 * Sab stored resources list karo (monitoring/debugging ke liye).
 */
export function listResources(): Array<{ uri: string; sizeBytes: number; storedAt: number; expiresAt: number }> {
  evictExpired();
  return Array.from(resourceStore.values()).map((r) => ({
    uri: r.uri,
    sizeBytes: r.sizeBytes,
    storedAt: r.storedAt,
    expiresAt: r.storedAt + RESOURCE_TTL_MS,
  }));
}
