/**
 * Spatial Data Interceptor
 * ─────────────────────────────────────────────────────────────
 * Intercepts MCP tool responses at the agent level (via afterToolCallback),
 * extracts large geospatial data (GeoJSON, Response_URLs, mapbox URIs),
 * stores it in a shared buffer, and returns a lightweight text summary
 * to the LLM — so the LLM never sees raw geometry data.
 *
 * Used by: adkAgent.ts → afterToolCallback on mapbox_agent & playground_agent
 * Consumed by: route.ts → reads extractedSpatialData after runner completes
 * ─────────────────────────────────────────────────────────────
 */
import {
  normalizeToGeoJSON,
  fetchAndNormalizeSpatialUrl,
} from "@/utils/spatialNormalizer";
import type { MapCommand } from "@/stores/useMapStore";

/** A single piece of spatial data intercepted from a tool response. */
export interface InterceptedSpatialData {
  toolName: string;
  label: string;
  geojson: any; // normalized GeoJSON FeatureCollection
  metadata: {
    featureCount: number;
    distanceKm?: string;
    durationMin?: string;
    summary?: string;
  };
}

/**
 * Shared buffer — created per-request by the route, passed into createADKAgent,
 * and populated by afterToolCallback. After runner.runAsync() completes,
 * the route reads this buffer to generate clientToolCommands.
 */
export type SpatialDataBuffer = InterceptedSpatialData[];

/**
 * Generates a short text summary for the LLM from extracted spatial data.
 * This replaces the full GeoJSON payload that would otherwise go to the LLM.
 */
export function createLightweightSummary(
  toolName: string,
  metadata: InterceptedSpatialData["metadata"],
  rawResponse?: any,
): string {
  const fc = metadata.featureCount;

  // Directions / route response
  if (rawResponse?.routes && rawResponse.routes.length > 0) {
    const r = rawResponse.routes[0];
    const dist = metadata.distanceKm || "?";
    const dur = metadata.durationMin || "?";
    const via = r.legs?.[0]?.summary || "";
    return (
      `✅ Route found: ${dist} km, ~${dur} min${via ? ` via ${via}` : ""}. ` +
      `${fc} features extracted and sent directly to the map for rendering. ` +
      `Do NOT call map_add_geojson — the map already has the data.`
    );
  }

  // Isochrone response
  if (rawResponse?.features && rawResponse.type === "FeatureCollection") {
    return (
      `✅ ${fc} spatial features returned and sent directly to the map. ` +
      `Do NOT re-render the data — the map already has it.`
    );
  }

  // Generic MCP response
  return (
    `✅ ${fc} features extracted from ${toolName} and sent directly to the map for rendering. ` +
    `Do NOT call map_add_geojson or map_load_url — the data is already on the map.`
  );
}

/**
 * Checks if a raw MCP tool response contains spatial data that should be
 * intercepted, extracted, and bypassed from the LLM.
 *
 * Returns { normalized, rawParsed } if spatial data found, null otherwise.
 */
export function extractSpatialFromResponse(
  toolName: string,
  rawResponse: any,
): { normalized: any; rawParsed: any } | null {
  if (!rawResponse || typeof rawResponse !== "object") return null;

  // ── Case 0: structuredContent (MCP structured output) ──
  if (rawResponse.structuredContent) {
    const sc = rawResponse.structuredContent;
    const norm = normalizeToGeoJSON(sc, toolName || "Spatial Data");
    if (norm?.features?.length > 0) {
      return { normalized: norm, rawParsed: sc };
    }
  }

  // ── Case 1: MCP content blocks array ──
  if (Array.isArray(rawResponse.content)) {
    for (const block of rawResponse.content) {
      // Text block — inline JSON/GeoJSON
      if (block.type === "text" && typeof block.text === "string") {
        const trimmed = block.text.trim();

        // Check for Response_URL pattern (Playground tools)
        const responseUrlMatch = trimmed.match(
          /Response_URL:\s*(https?:\/\/[^\s"']+)/,
        );
        if (responseUrlMatch) {
          // We can't do async fetch inside a sync check — return a special marker
          return {
            normalized: null,
            rawParsed: { _responseUrl: responseUrlMatch[1], _needsFetch: true },
          };
        }

        // Check for inline JSON
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          const norm = normalizeToGeoJSON(trimmed, toolName || "Spatial Data");
          if (norm?.features?.length > 0) {
            return { normalized: norm, rawParsed: JSON.parse(trimmed) };
          }
        }

        // Check for mapbox:// URI
        const mapboxUriMatch = trimmed.match(/mapbox:\/\/temp\/[^\s"']+/);
        if (mapboxUriMatch) {
          return {
            normalized: null,
            rawParsed: {
              _mapboxUri: mapboxUriMatch[0],
              _needsMcpResolve: true,
            },
          };
        }

        // Check for Mapbox API URL
        const httpUrlMatch = trimmed.match(
          /https:\/\/api\.mapbox\.com\/[^\s"']+/,
        );
        if (httpUrlMatch) {
          return {
            normalized: null,
            rawParsed: { _httpUrl: httpUrlMatch[0], _needsFetch: true },
          };
        }
      }

      // Resource block — inline data or URI
      if (block.type === "resource" && block.resource) {
        if (block.resource.text) {
          const norm = normalizeToGeoJSON(
            block.resource.text,
            toolName || "Spatial Data",
          );
          if (norm?.features?.length > 0) {
            return { normalized: norm, rawParsed: block.resource.text };
          }
        } else if (block.resource.blob) {
          try {
            const decoded = Buffer.from(block.resource.blob, "base64").toString(
              "utf-8",
            );
            const norm = normalizeToGeoJSON(
              decoded,
              toolName || "Spatial Data",
            );
            if (norm?.features?.length > 0) {
              return { normalized: norm, rawParsed: decoded };
            }
          } catch {
            /* ignore decode errors */
          }
        } else if (block.resource.uri) {
          return {
            normalized: null,
            rawParsed: {
              _mapboxUri: block.resource.uri,
              _needsMcpResolve: true,
            },
          };
        }
      }
    }
  }

  // ── Case 2: Direct object ──
  const norm = normalizeToGeoJSON(rawResponse, toolName || "Spatial Data");
  if (norm?.features?.length > 0) {
    return { normalized: norm, rawParsed: rawResponse };
  }

  // ── Case 3: URL string field ──
  if (typeof rawResponse.url === "string") {
    return {
      normalized: null,
      rawParsed: { _httpUrl: rawResponse.url, _needsFetch: true },
    };
  }

  return null;
}

/**
 * Extracts route-level metadata from raw Mapbox API responses
 * (distance, duration, etc.) without needing the full GeoJSON.
 */
export function extractMetadata(
  rawParsed: any,
  featureCount: number,
): InterceptedSpatialData["metadata"] {
  const meta: InterceptedSpatialData["metadata"] = { featureCount };

  if (rawParsed?.routes && rawParsed.routes.length > 0) {
    const r = rawParsed.routes[0];
    if (r.distance)
      meta.distanceKm = (r.distance / 1000).toFixed(1);
    if (r.duration)
      meta.durationMin = String(Math.round(r.duration / 60));
    if (r.legs?.[0]?.summary) meta.summary = r.legs[0].summary;
  }

  return meta;
}
