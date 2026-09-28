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
      properties: data.properties || { title: defaultLabel },
    };
  }

  // 4. Single GeoJSON Feature ({ type: "Feature", geometry: ... })
  if (data.type === "Feature" || (data.geometry && data.properties && !data.type)) {
    let feature = { type: "Feature", ...data };
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

  // 7b. Check for nearby_pois (e.g., from ground_location_tool)
  if (Array.isArray(data.nearby_pois) && data.nearby_pois.length > 0) {
    console.log(`[SpatialNormalizer] Found 'nearby_pois' array with ${data.nearby_pois.length} items. Converting to FeatureCollection.`);
    const features: any[] = [];

    // Include anchor / center place if available
    const centerLng = data.longitude ?? data.lng ?? data.lon;
    const centerLat = data.latitude ?? data.lat;
    if (typeof centerLng === "number" && typeof centerLat === "number") {
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [centerLng, centerLat],
        },
        properties: {
          name: data.place || data.name || data.full_address || "Search Center",
          address: data.full_address || data.address,
          type: "center",
        },
      });
    }

    for (const poi of data.nearby_pois) {
      const pLng = poi.longitude ?? poi.lng ?? poi.lon;
      const pLat = poi.latitude ?? poi.lat;
      if (typeof pLng === "number" && typeof pLat === "number") {
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [pLng, pLat],
          },
          properties: {
            name: poi.name || "POI",
            category: poi.category || poi.poi_category,
            address: poi.address || poi.full_address,
            distance_meters: poi.distance_meters,
            distance: poi.distance_meters != null ? `${poi.distance_meters}m` : undefined,
          },
        });
      }
    }

    if (features.length > 0) {
      return {
        type: "FeatureCollection",
        features,
      };
    }
  }

  // 7c. Check for places / results / pois arrays with lat/lon
  const possibleList = data.places || data.results || data.pois;
  if (Array.isArray(possibleList) && possibleList.length > 0) {
    console.log(`[SpatialNormalizer] Found list array with ${possibleList.length} items.`);
    const features: any[] = [];
    for (const item of possibleList) {
      const iLng = item.longitude ?? item.lng ?? item.lon ?? (Array.isArray(item.coordinates) ? item.coordinates[0] : undefined);
      const iLat = item.latitude ?? item.lat ?? (Array.isArray(item.coordinates) ? item.coordinates[1] : undefined);
      if (typeof iLng === "number" && typeof iLat === "number") {
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [iLng, iLat],
          },
          properties: {
            name: item.name || item.title || "Place",
            category: item.category || item.poi_category,
            address: item.address || item.full_address,
            ...item,
          },
        });
      }
    }
    if (features.length > 0) {
      return {
        type: "FeatureCollection",
        features,
      };
    }
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
            ...data,
            coordinates: undefined, // do not duplicate geometry in properties
            name: data.name || data.title || data.officeName || data.zipcode || defaultLabel,
          },
        },
      ],
    };
  }

  // 9. Single object with latitude and longitude directly
  const sLng = data.longitude ?? data.lng ?? data.lon;
  const sLat = data.latitude ?? data.lat;
  if (typeof sLng === "number" && typeof sLat === "number" && !data.type) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [sLng, sLat],
          },
          properties: {
            name: data.name || data.title || data.place || defaultLabel,
            ...data,
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
 * Resolves a mapbox://selffetch/directions URI into a full GeoJSON FeatureCollection
 * containing the route LineString geometry and waypoints from Mapbox Directions API.
 */
export async function resolveDirectionsSelfFetch(
  targetUrl: string,
  label: string = "Route",
  options?: SpatialFetchOptions
): Promise<any> {
  const queryIdx = targetUrl.indexOf("?data=");
  if (queryIdx === -1) return null;

  try {
    const rawParam = targetUrl.slice(queryIdx + 6).split("&")[0];
    const decodedStr =
      Buffer.from(rawParam, "base64url").toString("utf-8") ||
      Buffer.from(rawParam, "base64").toString("utf-8");
    const params = JSON.parse(decodedStr);

    if (!params || !Array.isArray(params.coordinates) || params.coordinates.length < 2) {
      return null;
    }

    const coordsStr = params.coordinates
      .map((c: any) => {
        const lng = c.longitude ?? c.lng ?? (Array.isArray(c) ? c[0] : undefined);
        const lat = c.latitude ?? c.lat ?? (Array.isArray(c) ? c[1] : undefined);
        return `${lng},${lat}`;
      })
      .join(";");

    let profile = params.routing_profile || "mapbox/driving-traffic";
    if (!profile.startsWith("mapbox/")) {
      profile = `mapbox/${profile}`;
    }

    const token =
      process.env.MAPBOX_SECRET_TOKEN ||
      process.env.MAPBOX_ACCESS_TOKEN ||
      options?.mapboxToken ||
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      "";

    if (!token) {
      console.warn("[SpatialNormalizer] No Mapbox token available to resolve directions selffetch.");
      return null;
    }

    const apiUrl = `https://api.mapbox.com/directions/v5/${profile}/${coordsStr}?geometries=geojson&overview=full&access_token=${token}`;
    console.log(`🗺️ [SpatialNormalizer] Resolving full route LineString from Mapbox Directions API (${profile})...`);

    const res = await fetch(apiUrl);
    if (!res.ok) {
      console.warn(`[SpatialNormalizer] Mapbox Directions API returned HTTP ${res.status}`);
      return null;
    }

    const apiData = await res.json();
    return normalizeToGeoJSON(apiData, label);
  } catch (err) {
    console.error("[SpatialNormalizer] Failed to resolve directions selffetch URI:", err);
    return null;
  }
}

/**
 * Resolves a mapbox://selffetch/isochrone URI into a GeoJSON FeatureCollection
 * containing polygon contours from Mapbox Isochrone API.
 */
export async function resolveIsochroneSelfFetch(
  targetUrl: string,
  label: string = "Isochrone",
  options?: SpatialFetchOptions
): Promise<any> {
  const queryIdx = targetUrl.indexOf("?data=");
  if (queryIdx === -1) return null;

  try {
    const rawParam = targetUrl.slice(queryIdx + 6).split("&")[0];
    const decodedStr =
      Buffer.from(rawParam, "base64url").toString("utf-8") ||
      Buffer.from(rawParam, "base64").toString("utf-8");
    const params = JSON.parse(decodedStr);

    if (!params || !params.coordinates) return null;

    const lng = params.coordinates.longitude ?? params.coordinates.lng ?? (Array.isArray(params.coordinates) ? params.coordinates[0] : undefined);
    const lat = params.coordinates.latitude ?? params.coordinates.lat ?? (Array.isArray(params.coordinates) ? params.coordinates[1] : undefined);
    if (typeof lng !== "number" || typeof lat !== "number") return null;

    let profile = params.profile || "mapbox/driving";
    if (!profile.startsWith("mapbox/")) {
      profile = `mapbox/${profile}`;
    }

    const minutes = Array.isArray(params.contours_minutes)
      ? params.contours_minutes.join(",")
      : "15";

    const token =
      process.env.MAPBOX_SECRET_TOKEN ||
      process.env.MAPBOX_ACCESS_TOKEN ||
      options?.mapboxToken ||
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      "";

    if (!token) return null;

    const apiUrl = `https://api.mapbox.com/isochrone/v1/${profile}/${lng},${lat}?contours_minutes=${minutes}&polygons=true&access_token=${token}`;
    console.log(`🗺️ [SpatialNormalizer] Resolving isochrone geometry from Mapbox API (${profile})...`);

    const res = await fetch(apiUrl);
    if (!res.ok) return null;

    const apiData = await res.json();
    return normalizeToGeoJSON(apiData, label);
  } catch (err) {
    console.error("[SpatialNormalizer] Failed to resolve isochrone selffetch URI:", err);
    return null;
  }
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
    // 1a. Directions self-fetch: fetch real route geometry (LineString) from Mapbox Directions API
    if (targetUrl.includes("mapbox://selffetch/directions")) {
      const directionsResult = await resolveDirectionsSelfFetch(targetUrl, label, options);
      if (directionsResult) return directionsResult;
    }

    // 1b. Isochrone self-fetch: fetch real contour polygons from Mapbox Isochrone API
    if (targetUrl.includes("mapbox://selffetch/isochrone")) {
      const isochroneResult = await resolveIsochroneSelfFetch(targetUrl, label, options);
      if (isochroneResult) return isochroneResult;
    }

    // 1c. General inline data (?data=) fallback
    if (targetUrl.includes("?data=")) {
      try {
        const queryIdx = targetUrl.indexOf("?data=");
        const rawParam = targetUrl.slice(queryIdx + 6).split("&")[0];
        const decodedStr = Buffer.from(rawParam, "base64url").toString("utf-8") ||
                           Buffer.from(rawParam, "base64").toString("utf-8");
        const parsed = JSON.parse(decodedStr);
        const norm = normalizeToGeoJSON(parsed, label);
        if (norm?.features?.length > 0) return norm;
      } catch (e) {
        console.warn(`[SpatialNormalizer] Could not decode inline data from URI: ${targetUrl}`, e);
      }
    }

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

  // 1.5 Handle Local File Paths (e.g. /Users/..., file://..., C:\..., relative paths)
  const isLocalFilePath =
    targetUrl.startsWith("file://") ||
    targetUrl.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(targetUrl) ||
    targetUrl.startsWith("./") ||
    targetUrl.startsWith("../");

  if (isLocalFilePath) {
    try {
      let filePath = targetUrl;
      if (filePath.startsWith("file://")) {
        try {
          filePath = new URL(filePath).pathname;
        } catch {
          filePath = filePath.replace(/^file:\/\//, "");
        }
      }

      const fileLabel =
        label &&
        label !== "Spatial Layer" &&
        label !== "Route Layer" &&
        label !== "External Data"
          ? label
          : filePath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Local Layer";

      if (typeof window === "undefined") {
        // Server-side: read directly from local filesystem
        const fs = await import("fs");
        if (fs.existsSync(filePath)) {
          console.log(`🗺️ [SpatialNormalizer] Reading local file from disk: ${filePath}`);
          const fileContent = await fs.promises.readFile(filePath, "utf-8");
          const rawData = JSON.parse(fileContent);
          const normalized = normalizeToGeoJSON(rawData, fileLabel);
          if (normalized) {
            normalized._sourcePath = filePath;
          }
          return normalized;
        } else {
          console.error(`[SpatialNormalizer] Local file does not exist: ${filePath}`);
          return null;
        }
      } else {
        // Client-side (browser): fetch via POST /api/select-file
        console.log(`🗺️ [SpatialNormalizer] Requesting local file via API: ${filePath}`);
        const res = await fetch("/api/select-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath }),
        });
        if (res.ok) {
          const rawData = await res.json();
          const normalized = normalizeToGeoJSON(rawData, fileLabel);
          if (normalized) {
            normalized._sourcePath = filePath;
          }
          return normalized;
        } else {
          console.error(`[SpatialNormalizer] Failed to fetch local file via API: HTTP ${res.status}`);
          return null;
        }
      }
    } catch (err: any) {
      console.error("[SpatialNormalizer] Failed to read or parse local file:", targetUrl, err);
      return null;
    }
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
