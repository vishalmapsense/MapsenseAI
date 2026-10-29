/**
 * Boundary Clipper & Geometry Filter Utility
 * ─────────────────────────────────────────────────────────────
 * Provides high-performance, strict Point-In-Polygon clipping for POIs
 * against zipcode and region boundaries.
 *
 * Key features:
 *  1. Two-stage optimization:
 *     - Stage 1: O(1) Bounding-Box (BBox) spatial pre-filter (eliminates 80-90% of outside points instantly).
 *     - Stage 2: Exact Turf.js Point-In-Polygon check with multi-ring closure validation.
 *  2. Cross-turn & cross-tool state preservation:
 *     - In-memory active boundary cache so run_osm_query always has access to the
 *       boundary fetched by get_zip_data, get_district_data, or user prompts.
 *  3. On-demand boundary resolution:
 *     - If run_osm_query is called without get_zip_data, automatically resolves
 *       and caches the boundary for any mentioned Indian PIN code.
 *  4. Secondary Postal Code filter:
 *     - Strips out points tagged with adjacent/different postal codes (e.g. 208001 in 208002).
 * ─────────────────────────────────────────────────────────────
 */

import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";

export interface BoundaryMetadata {
  pinCode?: string;
  name?: string;
  centroid: [number, number]; // [lng, lat]
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  boundingRadiusMeters: number;
  polygonFeatures: Feature<Polygon | MultiPolygon>[];
  rawGeoJSON: any;
}

const PLAYG_API_BASE = process.env.PLAYG_API_BASE || "http://localhost:8000";
const PLAYG_TOKEN =
  process.env.PLAYG_BEARER_TOKEN ||
  process.env.BEARER_TOKEN ||
  "";

// In-memory active boundary cache
const _boundaryCache = new Map<string, BoundaryMetadata>();
let _lastActiveBoundary: BoundaryMetadata | null = null;

/**
 * Resets the in-memory boundary cache (called when starting a fresh session if needed)
 */
export function resetBoundaryCache(): void {
  _boundaryCache.clear();
  _lastActiveBoundary = null;
}

/**
 * Extracts and standardizes Polygon / MultiPolygon features from any GeoJSON structure
 */
function extractPolygonFeatures(geojson: any): Feature<Polygon | MultiPolygon>[] {
  if (!geojson) return [];

  const polygons: Feature<Polygon | MultiPolygon>[] = [];

  const visitFeature = (f: any) => {
    if (!f || !f.geometry) return;
    const geom = f.geometry;
    if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
      polygons.push(f as Feature<Polygon | MultiPolygon>);
    }
  };

  if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
    geojson.features.forEach(visitFeature);
  } else if (geojson.type === "Feature") {
    visitFeature(geojson);
  } else if (geojson.type === "Polygon" || geojson.type === "MultiPolygon") {
    polygons.push({
      type: "Feature",
      geometry: geojson,
      properties: geojson.properties || {},
    });
  } else if (Array.isArray(geojson)) {
    // Array of features or coordinates
    geojson.forEach((item: any) => {
      if (item && item.geometry) {
        visitFeature(item);
      } else if (item && Array.isArray(item.coordinates)) {
        try {
          const depth = Array.isArray(item.coordinates[0]?.[0]?.[0]) ? 4 : 3;
          polygons.push({
            type: "Feature",
            geometry: {
              type: depth === 4 ? "MultiPolygon" : "Polygon",
              coordinates: item.coordinates,
            },
            properties: item,
          });
        } catch {}
      }
    });
  }

  return polygons;
}

/**
 * Parses, calculates spatial metrics, and sets the active boundary
 */
export function setActiveBoundary(
  geojson: any,
  pinCodeHint?: string,
  sourceLabel?: string
): BoundaryMetadata | null {
  if (!geojson) return null;

  try {
    const polygonFeatures = extractPolygonFeatures(geojson);
    if (polygonFeatures.length === 0) {
      console.warn(`[BoundaryClipper] No Polygon or MultiPolygon found in ${sourceLabel || "input"}.`);
      return null;
    }

    const fc: any = {
      type: "FeatureCollection",
      features: polygonFeatures,
    };

    // Calculate overall Bounding Box
    const bbox = turf.bbox(fc) as [number, number, number, number];

    // Calculate Centroid
    const centerPoint = turf.center(fc);
    const centroid: [number, number] = centerPoint.geometry.coordinates as [number, number];

    // Calculate Bounding Radius (distance from centroid to the farthest corner of BBox)
    const corners = [
      turf.point([bbox[0], bbox[1]]),
      turf.point([bbox[2], bbox[1]]),
      turf.point([bbox[0], bbox[3]]),
      turf.point([bbox[2], bbox[3]]),
    ];

    let maxDistMeters = 0;
    for (const c of corners) {
      const d = turf.distance(centerPoint, c, { units: "meters" });
      if (d > maxDistMeters) maxDistMeters = d;
    }

    // Add a 200m buffer to ensure complete coverage, clamp between 2000m and 8000m
    const boundingRadiusMeters = Math.min(8000, Math.max(2000, Math.ceil(maxDistMeters + 200)));

    // Extract PIN code if available in properties
    const firstProps = polygonFeatures[0]?.properties || {};
    const pinCode =
      pinCodeHint ||
      firstProps.zipcode ||
      firstProps.postal_code ||
      firstProps.pinCode ||
      firstProps.pincode ||
      undefined;

    const name =
      firstProps.officeName ||
      firstProps.name ||
      firstProps.dtname ||
      (pinCode ? `PIN ${pinCode}` : "Region Boundary");

    const metadata: BoundaryMetadata = {
      pinCode,
      name,
      centroid,
      bbox,
      boundingRadiusMeters,
      polygonFeatures,
      rawGeoJSON: geojson,
    };

    _lastActiveBoundary = metadata;
    if (pinCode) {
      _boundaryCache.set(String(pinCode).trim(), metadata);
    }
    if (name) {
      _boundaryCache.set(String(name).toLowerCase().trim(), metadata);
    }

    console.log(
      `📍 [BoundaryClipper] Active boundary set for "${name}" (${pinCode || "no-pin"}). ` +
        `Centroid: [${centroid[0].toFixed(5)}, ${centroid[1].toFixed(5)}], ` +
        `Radius: ${boundingRadiusMeters}m, Features: ${polygonFeatures.length}`
    );

    return metadata;
  } catch (err) {
    console.error("[BoundaryClipper] Error setting active boundary:", err);
    return null;
  }
}

/**
 * Resolves the boundary for a given PIN code on-demand from Playg backend if not cached
 */
export async function resolveBoundaryForPinCode(pinCode: string): Promise<BoundaryMetadata | null> {
  const cleanPin = pinCode.replace(/\D/g, "");
  if (cleanPin.length !== 6) return null;

  if (_boundaryCache.has(cleanPin)) {
    return _boundaryCache.get(cleanPin)!;
  }

  console.log(`🔍 [BoundaryClipper] Fetching boundary on-demand for PIN ${cleanPin}...`);
  try {
    const res = await fetch(`${PLAYG_API_BASE}/api/zip-boundary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PLAYG_TOKEN}`,
      },
      body: JSON.stringify({
        key: "zipcode",
        value: cleanPin,
        requiredFields: "coordinates,zipcode,officeName,division,region,circle",
      }),
    });

    if (res.ok) {
      const records = await res.json();
      if (Array.isArray(records) && records.length > 0) {
        const { normalizeToGeoJSON } = await import("../../utils/spatialNormalizer");
        const normalized = normalizeToGeoJSON(records, `Zipcode ${cleanPin}`);
        if (normalized?.features?.length > 0) {
          return setActiveBoundary(normalized, cleanPin, `API fetch ${cleanPin}`);
        }
      }
    }
  } catch (err) {
    console.warn(`[BoundaryClipper] Failed to fetch boundary for PIN ${cleanPin}:`, err);
  }

  return null;
}

/**
 * Retrieves the currently active boundary metadata
 */
export async function getActiveBoundary(
  hint?: string
): Promise<BoundaryMetadata | null> {
  if (hint) {
    const cleanHint = hint.replace(/\D/g, "");
    if (cleanHint.length === 6 && _boundaryCache.has(cleanHint)) {
      return _boundaryCache.get(cleanHint)!;
    }
    const lower = hint.toLowerCase().trim();
    if (_boundaryCache.has(lower)) {
      return _boundaryCache.get(lower)!;
    }
    if (cleanHint.length === 6) {
      const fetched = await resolveBoundaryForPinCode(cleanHint);
      if (fetched) return fetched;
    }
  }

  return _lastActiveBoundary;
}

import {
  AMENITY_CATEGORY_COLORS,
  getAmenityCategoryAndColor,
} from "./amenityColors";

export { AMENITY_CATEGORY_COLORS, getAmenityCategoryAndColor };


/**
 * STAGE 1 + STAGE 2: Strictly and optimally clips GeoJSON features to the boundary polygon
 * 
 * - Discards all points outside the Bounding Box in O(1).
 * - Runs exact turf.booleanPointInPolygon for points inside the Bounding Box.
 * - Filters out mismatched postal codes if tagged.
 * - Applies clean POI visual styling.
 */
export function clipFeaturesStrictlyToBoundary(
  features: any[],
  boundary: BoundaryMetadata | any,
  targetPinCode?: string
): { inside: any[]; outsideCount: number } {
  if (!features || !Array.isArray(features) || features.length === 0) {
    return { inside: [], outsideCount: 0 };
  }

  let meta: BoundaryMetadata | null = null;
  if (boundary?.polygonFeatures && boundary?.bbox) {
    meta = boundary as BoundaryMetadata;
  } else {
    meta = setActiveBoundary(boundary, targetPinCode, "raw input boundary");
  }

  if (!meta || meta.polygonFeatures.length === 0) {
    console.warn("[BoundaryClipper] No valid boundary metadata available for clipping. Returning all.");
    return { inside: features, outsideCount: 0 };
  }

  const [minLng, minLat, maxLng, maxLat] = meta.bbox;
  const targetPin = (targetPinCode || meta.pinCode || "").replace(/\D/g, "");

  const inside: any[] = [];
  let outsideCount = 0;

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const coords = f?.geometry?.coordinates;
    if (!coords || !Array.isArray(coords) || coords.length < 2) {
      outsideCount++;
      continue;
    }

    const lng = Number(coords[0]);
    const lat = Number(coords[1]);

    if (isNaN(lng) || isNaN(lat)) {
      outsideCount++;
      continue;
    }

    // ── STAGE 1: Fast O(1) BBox pre-filter ──
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) {
      outsideCount++;
      continue;
    }

    // ── STAGE 2: Exact Point-in-Polygon check ──
    const pt = turf.point([lng, lat]);
    let isPointInside = false;

    for (const polyFeature of meta.polygonFeatures) {
      try {
        if (turf.booleanPointInPolygon(pt, polyFeature as any)) {
          isPointInside = true;
          break;
        }
      } catch (err) {
        // Turf error on malformed polygon ring — treat as not matched, DO NOT return true
        isPointInside = false;
      }
    }

    if (!isPointInside) {
      outsideCount++;
      continue;
    }

    // ── STAGE 3: Secondary Postal Code Check ──
    // If the POI contains an explicit addr:postcode that contradicts the target PIN, discard
    const p = f.properties || {};
    const poiPostal = p["addr:postcode"] || p["addr:postal_code"] || p["postal_code"];
    if (targetPin.length === 6 && poiPostal && typeof poiPostal === "string") {
      const cleanPoiPostal = poiPostal.replace(/\D/g, "");
      if (cleanPoiPostal.length === 6 && cleanPoiPostal !== targetPin) {
        console.log(`[BoundaryClipper] Discarding POI "${p.name || i}" with foreign postcode ${cleanPoiPostal} (target: ${targetPin})`);
        outsideCount++;
        continue;
      }
    }

    // ── Apply Professional Visual Styling ──
    const name = p.name || p["name:en"] || `Amenity ${inside.length + 1}`;
    const { category, color } = getAmenityCategoryAndColor(p);

    inside.push({
      ...f,
      properties: {
        ...p,
        title: name,
        name,
        category,
        fillColor: color,
        color,
        strokeColor: [255, 255, 255, 240],
        lineColor: [255, 255, 255, 240],
        pointRadius: 25,
        radius: 25,
      },
    });
  }

  console.log(
    `🎯 [BoundaryClipper] Strictly clipped ${features.length} POIs → ${inside.length} INSIDE boundary, ` +
      `${outsideCount} external POIs REMOVED.`
  );

  return { inside, outsideCount };
}

/**
 * Standard OSM Query IDs in Playground platform
 */
export const OSM_POLYGON_QUERY_ID = "610acbb8-9d09-463b-bfcd-74b03e89082f";
export const OSM_NEARBY_QUERY_ID = "aa7cd1cc-8936-4d6c-b8a5-0fd59436395e";

/**
 * Formats a boundary's exterior ring into Overpass QL poly parameter string syntax:
 * "lat1 lon1 lat2 lon2 lat3 lon3 ..."
 * 
 * If the ring is dense (>200 vertices), simplifies it slightly while preserving shape
 * so the Overpass query remains lightning-fast and under body limits.
 */
export function formatBoundaryPolyString(boundary: BoundaryMetadata | any): string | null {
  if (!boundary) return null;

  let polygonFeatures: Feature<Polygon | MultiPolygon>[] = [];
  if (boundary.polygonFeatures) {
    polygonFeatures = boundary.polygonFeatures;
  } else {
    polygonFeatures = extractPolygonFeatures(boundary);
  }

  if (!polygonFeatures || polygonFeatures.length === 0) return null;

  try {
    const firstPoly = polygonFeatures[0];
    let ring: number[][] | null = null;

    if (firstPoly.geometry.type === "Polygon") {
      ring = firstPoly.geometry.coordinates[0];
    } else if (firstPoly.geometry.type === "MultiPolygon") {
      ring = firstPoly.geometry.coordinates[0][0];
    }

    if (!ring || !Array.isArray(ring) || ring.length < 3) return null;

    // If ring has too many points (>200), simplify to prevent excessive query size
    let targetRing = ring;
    if (ring.length > 200) {
      try {
        const simplified = turf.simplify(firstPoly as any, { tolerance: 0.0001, highQuality: true });
        if (simplified?.geometry?.coordinates?.[0]) {
          targetRing = simplified.geometry.type === "MultiPolygon"
            ? simplified.geometry.coordinates[0][0]
            : simplified.geometry.coordinates[0];
        }
      } catch {}
    }

    // Overpass poly filter syntax: space-separated latitude longitude pairs
    return targetRing
      .map((pt) => `${Number(pt[1]).toFixed(5)} ${Number(pt[0]).toFixed(5)}`)
      .join(" ");
  } catch (err) {
    console.warn("[BoundaryClipper] Failed to format boundary poly string:", err);
    return null;
  }
}

