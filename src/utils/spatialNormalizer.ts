/**
 * Spatial Normalizer Utility (Browser & Server Safe)
 * ─────────────────────────────────────────────────────────────
 * Normalizes Mapbox API responses, encoded polylines, URLs, and raw spatial data
 * into clean, standard GeoJSON FeatureCollections for map rendering.
 * ─────────────────────────────────────────────────────────────
 */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  if (!str || typeof str !== "string") return [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: [number, number][] = [];
  const factor = Math.pow(10, precision);

  while (index < str.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    const parsedLng = lng / factor;
    const parsedLat = lat / factor;

    // Validate bounds
    if (parsedLng >= -180 && parsedLng <= 180 && parsedLat >= -90 && parsedLat <= 90) {
      coordinates.push([parsedLng, parsedLat]);
    }
  }

  // Fallback to precision 5 if precision 6 returned no valid coordinates
  if (coordinates.length === 0 && precision === 6) {
    return decodePolyline(str, 5);
  }

  return coordinates;
}

/**
 * Normalizes any spatial input (Mapbox API responses, Directions, Isochrones,
 * encoded Polylines, raw Geometries, Features, or FeatureCollections) into a
 * valid GeoJSON FeatureCollection object.
 */
export function normalizeToGeoJSON(rawData: any, defaultLabel: string = "Spatial Feature"): any {
  if (!rawData) return null;
  console.log(`🗺️ [SpatialNormalizer] Normalizing input for '${defaultLabel}'. Type: ${typeof rawData}`);

  let data = rawData;

  // 1. Handle JSON string input
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        data = JSON.parse(trimmed);
      } catch (e) {
        // Not JSON string, might be encoded polyline string
      }
    } else {
      // Try decoding as encoded polyline string
      const coords = decodePolyline(trimmed);
      if (coords.length > 0) {
        return {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: coords,
              },
              properties: { name: defaultLabel },
            },
          ],
        };
      }
    }
  }

  if (!data || typeof data !== "object") return null;

  // 2. Mapbox Directions API Response ({ routes: [...], waypoints: [...] })
  if (Array.isArray(data.routes) && data.routes.length > 0) {
    const features: any[] = [];

    data.routes.forEach((route: any, index: number) => {
      let geom: any = null;

      if (route.geometry && typeof route.geometry === "object" && route.geometry.type) {
        geom = route.geometry;
      } else if (typeof route.geometry === "string") {
        const coords = decodePolyline(route.geometry);
        if (coords.length > 0) {
          geom = {
            type: "LineString",
            coordinates: coords,
          };
        }
      }

      if (geom) {
        features.push({
          type: "Feature",
          geometry: geom,
          properties: {
            name: `${defaultLabel}${data.routes.length > 1 ? ` (Route ${index + 1})` : ""}`,
            distance: route.distance ? `${(route.distance / 1000).toFixed(2)} km` : undefined,
            duration: route.duration ? `${Math.round(route.duration / 60)} min` : undefined,
            summary: route.legs?.[0]?.summary || route.weight_name || undefined,
          },
        });
      }
    });

    // Extract waypoints as Point markers if present
    if (Array.isArray(data.waypoints)) {
      data.waypoints.forEach((wp: any, idx: number) => {
        if (Array.isArray(wp.location) && wp.location.length >= 2) {
          features.push({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [wp.location[0], wp.location[1]],
            },
            properties: {
              name: wp.name || (idx === 0 ? "Start" : idx === data.waypoints.length - 1 ? "Destination" : `Waypoint ${idx}`),
              type: "marker",
            },
          });
        }
      });
    }

    if (features.length > 0) {
      return {
        type: "FeatureCollection",
        features,
      };
    }
  }

  // 3. Direct FeatureCollection ({ type: "FeatureCollection", features: [...] })
  if (data.type === "FeatureCollection") {
    const features = Array.isArray(data.features)
      ? data.features.map((f: any) => {
          if (!f || typeof f !== "object") return null;

          let feature = f;
          if (typeof f.geometry === "string") {
            const coords = decodePolyline(f.geometry);
            if (coords.length > 0) {
              feature = {
                ...f,
                geometry: { type: "LineString", coordinates: coords },
              };
            }
          }

          if (!feature.properties) {
            feature.properties = { name: defaultLabel };
          }
          return feature;
        }).filter(Boolean)
      : [];

    return {
      type: "FeatureCollection",
      features,
    };
  }

  // 4. Single GeoJSON Feature ({ type: "Feature", geometry: ... })
  if (data.type === "Feature") {
    let feature = { ...data };
    if (typeof feature.geometry === "string") {
      const coords = decodePolyline(feature.geometry);
      if (coords.length > 0) {
        feature.geometry = { type: "LineString", coordinates: coords };
      }
    }
    if (!feature.properties) {
      feature.properties = { name: defaultLabel };
    }
    return {
      type: "FeatureCollection",
      features: [feature],
    };
  }

  // 5. Bare GeoJSON Geometry ({ type: "LineString" | "Polygon" | "Point", coordinates: [...] })
  const GEOM_TYPES = ["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"];
  if (data.type && GEOM_TYPES.includes(data.type)) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: data,
          properties: { name: defaultLabel },
        },
      ],
    };
  }

  // 6. Array of features
  if (Array.isArray(data)) {
    const normalizedList = data.map((item) => normalizeToGeoJSON(item, defaultLabel)).filter(Boolean);
    const allFeatures = normalizedList.flatMap((fc) => fc.features || []);
    if (allFeatures.length > 0) {
      return {
        type: "FeatureCollection",
        features: allFeatures,
      };
    }
  }

  // 7. Check if it's wrapped in a data or result property
  if (data.data && typeof data.data === "object") {
    console.log(`[SpatialNormalizer] Found 'data' property, trying to normalize it recursively.`);
    const result = normalizeToGeoJSON(data.data, defaultLabel);
    if (result) return result;
  }
  
  if (data.geojson && typeof data.geojson === "object") {
    console.log(`[SpatialNormalizer] Found 'geojson' property, trying to normalize it recursively.`);
    const result = normalizeToGeoJSON(data.geojson, defaultLabel);
    if (result) return result;
  }

  // 8. Custom raw object with coordinates but no geometry type (e.g. { id, coordinates })
  if (Array.isArray(data.coordinates)) {
    console.log(`[SpatialNormalizer] Found raw 'coordinates' property. Inferring geometry type...`);
    
    // Simple heuristic to infer geometry type by depth of the array
    let depth = 0;
    let curr = data.coordinates;
    while (Array.isArray(curr) && curr.length > 0) {
      depth++;
      curr = curr[0];
    }
    
    let inferredType = "Point";
    if (depth === 2) inferredType = "LineString";
    if (depth === 3) inferredType = "Polygon";
    if (depth === 4) inferredType = "MultiPolygon";

    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: inferredType,
            coordinates: data.coordinates,
          },
          properties: { 
            name: defaultLabel,
            id: data.id || undefined 
          },
        },
      ],
    };
  }

  console.warn("[SpatialNormalizer] Could not normalize data. Object keys:", Object.keys(data));
  return null;
}

export type McpResourceResolver = (uri: string) => Promise<any>;

export interface SpatialFetchOptions {
  mapboxToken?: string;
  resolveMcpResource?: McpResourceResolver;
}

/**
 * Fetches or resolves a spatial URL or MCP resource URI (including mapbox://temp/...,
 * Mapbox API URLs requiring access_token, and GitHub GeoJSON links),
 * parses the response, and normalizes it to a GeoJSON FeatureCollection.
 */
export async function fetchAndNormalizeSpatialUrl(
  url: string,
  label: string = "Spatial Layer",
  options?: SpatialFetchOptions
): Promise<any> {
  if (!url || typeof url !== "string") return null;

  let targetUrl = url.trim();

  // 1. Handle Mapbox / MCP custom resource URIs (e.g. mapbox://temp/..., geojson://...)
  if (targetUrl.startsWith("mapbox://") || targetUrl.startsWith("geojson://")) {
    if (options?.resolveMcpResource) {
      try {
        console.log(`[SpatialNormalizer] Resolving MCP resource URI via resolver: ${targetUrl}`);
        const mcpResult: any = await options.resolveMcpResource(targetUrl);
        if (mcpResult) {
          return normalizeToGeoJSON(mcpResult, label);
        }
      } catch (e: any) {
        console.error(`[SpatialNormalizer] Failed to read MCP resource '${targetUrl}':`, e);
      }
    } else {
      console.warn(`[SpatialNormalizer] Custom scheme '${targetUrl}' received without resolveMcpResource handler.`);
    }
    return null;
  }

  // 2. Handle HTTP / HTTPS URLs
  try {
    // Convert GitHub blob URLs to raw usercontent URLs if needed
    if (targetUrl.includes("github.com") && targetUrl.includes("/blob/")) {
      targetUrl = targetUrl
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }

    const urlObj = new URL(targetUrl);

    // If it's a Mapbox API URL (api.mapbox.com)
    if (urlObj.hostname.includes("mapbox.com")) {
      const validToken =
        process.env.MAPBOX_SECRET_TOKEN ||
        process.env.MAPBOX_ACCESS_TOKEN ||
        options?.mapboxToken ||
        process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
        "";

      if (validToken) {
        urlObj.searchParams.set("access_token", validToken);
      }

      if (urlObj.pathname.includes("/directions/") && !urlObj.searchParams.has("geometries")) {
        urlObj.searchParams.set("geometries", "geojson");
      }

      targetUrl = urlObj.toString();
    }

    const response = await fetch(targetUrl);
    if (!response.ok) {
      console.warn(`[SpatialNormalizer] HTTP ${response.status} when fetching URL: ${targetUrl}`);
      return null;
    }

    const rawData = await response.json();
    console.log(`[SpatialNormalizer] Raw Data from URL (${targetUrl}):`, JSON.stringify(rawData, null, 2));
    return normalizeToGeoJSON(rawData, label);
  } catch (err: any) {
    console.error("[SpatialNormalizer] Failed to fetch or normalize URL:", targetUrl, err);
    return null;
  }
}
