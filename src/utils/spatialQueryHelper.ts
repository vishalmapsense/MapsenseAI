import { Buffer } from "buffer";
import wkx from "wkx";
import * as turf from "@turf/turf";
import type { QueryResultData, SuggestedVisualizationLayer } from "@/types/mcp.types";
import { suggestVisualizationLayers } from "@/agents/utils/layerSuggestionEngine";

/**
 * Attempts to parse any geometry value into a valid GeoJSON Geometry object.
 * Supports:
 * - GeoJSON geometry object
 * - GeoJSON feature object
 * - JSON strings (including escaped JSON)
 * - Coordinate arrays: [lng, lat]
 * - WKT strings: POINT, POLYGON, LINESTRING, MULTIPOINT, etc.
 * - WKB buffers or hex strings
 */
export function parseGeometryValue(val: any): any | null {
  if (val === null || val === undefined) return null;

  // 1. Direct object
  if (typeof val === "object") {
    if (val.type && (val.coordinates || val.geometries)) return val;
    if (val.geometry?.type && (val.geometry.coordinates || val.geometry.geometries)) return val.geometry;
    if (val instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(val))) {
      try {
        return wkx.Geometry.parse(Buffer.from(val)).toGeoJSON();
      } catch {
        try {
          const str = new TextDecoder().decode(val).trim();
          if (str.length > 0) {
            return parseGeometryValue(str);
          }
        } catch {}
        return null;
      }
    }
    return null;
  }

  // 2. String representation
  if (typeof val === "string") {
    let str = val.trim();
    if (!str) return null;

    // Strip wrapping quotes if any (e.g. '"{"type":...}"' or "'{...}'")
    if (
      (str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))
    ) {
      str = str.slice(1, -1).trim();
    }
    // Unescape double quotes from CSV/SQL
    if (str.includes('""')) {
      str = str.replace(/""/g, '"');
    }

    // JSON parse attempt
    if (str.startsWith("{") || str.startsWith("[")) {
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed) && parsed.length >= 2 && typeof parsed[0] === "number" && typeof parsed[1] === "number") {
          return { type: "Point", coordinates: [parsed[0], parsed[1]] };
        }
        if (parsed.type && (parsed.coordinates || parsed.geometries)) return parsed;
        if (parsed.geometry?.type) return parsed.geometry;
      } catch {
        // Fall through to WKT / Hex check
      }
    }

    // WKT parse attempt (e.g. POINT(x y), POLYGON(...), SRID=4326;POINT(...))
    const upper = str.toUpperCase();
    if (
      upper.startsWith("POINT") ||
      upper.startsWith("LINESTRING") ||
      upper.startsWith("POLYGON") ||
      upper.startsWith("MULTIPOINT") ||
      upper.startsWith("MULTILINESTRING") ||
      upper.startsWith("MULTIPOLYGON") ||
      upper.startsWith("GEOMETRYCOLLECTION") ||
      upper.startsWith("SRID=")
    ) {
      try {
        return wkx.Geometry.parse(str).toGeoJSON();
      } catch {
        // Regex fallback for simple POINT(lng lat)
        const ptMatch = str.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
        if (ptMatch) {
          const x = parseFloat(ptMatch[1]);
          const y = parseFloat(ptMatch[2]);
          if (!isNaN(x) && !isNaN(y)) {
            return { type: "Point", coordinates: [x, y] };
          }
        }
      }
    }

    // Hex string (WKB) attempt (e.g. 0101000000...)
    if (/^[0-9a-fA-F]{16,}$/.test(str)) {
      try {
        return wkx.Geometry.parse(Buffer.from(str, "hex")).toGeoJSON();
      } catch {
        // Not WKB
      }
    }
  }

  return null;
}

/**
 * Finds column indices representing coordinate pairs (lng & lat) in query results.
 */
export function findCoordinateColumnIndices(columns: string[]): { lngIdx: number; latIdx: number } | null {
  const lowerCols = columns.map((c) => c.toLowerCase());

  // Priority 1: centroid / precomputed center columns
  const centerLngIdx = lowerCols.indexOf("center_lng");
  const centerLatIdx = lowerCols.indexOf("center_lat");
  if (centerLngIdx !== -1 && centerLatIdx !== -1) {
    return { lngIdx: centerLngIdx, latIdx: centerLatIdx };
  }

  // Priority 2: lng & lat (or lon & lat, longitude & latitude)
  const lngIdx = lowerCols.findIndex(
    (c) =>
      c === "lng" ||
      c === "longitude" ||
      c === "lon" ||
      c.endsWith("_lng") ||
      c.endsWith("_longitude") ||
      c.endsWith("_lon")
  );
  const latIdx = lowerCols.findIndex(
    (c) =>
      c === "lat" ||
      c === "latitude" ||
      c.endsWith("_lat") ||
      c.endsWith("_latitude")
  );
  if (lngIdx !== -1 && latIdx !== -1) {
    return { lngIdx, latIdx };
  }

  // Priority 3: x & y
  const xIdx = lowerCols.indexOf("x");
  const yIdx = lowerCols.indexOf("y");
  if (xIdx !== -1 && yIdx !== -1) {
    return { lngIdx: xIdx, latIdx: yIdx };
  }

  return null;
}

/**
 * Finds the index of a geometry or spatial column in query results.
 */
export function findSpatialColumnIndex(columns: string[], rows?: any[][]): number {
  const lowerCols = columns.map((c) => c.toLowerCase());

  // 1. Check known geometry column names
  const spatialColNames = [
    "geometry",
    "geom",
    "the_geom",
    "geojson",
    "centroid",
    "st_centroid",
    "st_asgeojson",
    "wkb_geometry",
    "shape",
    "geom_json",
    "location",
    "position",
    "point",
  ];
  for (const name of spatialColNames) {
    const idx = lowerCols.indexOf(name);
    if (idx !== -1) return idx;
  }

  // 2. Check prefix / suffix
  const patternIdx = lowerCols.findIndex(
    (c) =>
      c.startsWith("st_") ||
      c.endsWith("_geom") ||
      c.endsWith("_geometry") ||
      c.endsWith("_geojson")
  );
  if (patternIdx !== -1) return patternIdx;

  // 3. Inspect first 5 rows to see if any column values parse as geometry
  if (rows && rows.length > 0) {
    for (let c = 0; c < columns.length; c++) {
      for (let r = 0; r < Math.min(5, rows.length); r++) {
        if (parseGeometryValue(rows[r][c])) {
          return c;
        }
      }
    }
  }

  return -1;
}

/**
 * Decodes a Bing Maps QuadKey into bounding box and polygon coordinates.
 */
export function quadKeyToBounds(quadKey: string | number): {
  center: { lng: number; lat: number };
  bounds: [number, number, number, number];
  polygon: [number, number][];
} {
  const qStr = String(quadKey).trim();
  const zoom = qStr.length;
  let tileX = 0;
  let tileY = 0;
  for (let i = zoom; i > 0; i--) {
    const mask = 1 << (i - 1);
    const char = qStr[zoom - i];
    if (char === "1") {
      tileX |= mask;
    } else if (char === "2") {
      tileY |= mask;
    } else if (char === "3") {
      tileX |= mask;
      tileY |= mask;
    }
  }

  const n = Math.pow(2, zoom);
  const lng1 = (tileX / n) * 360 - 180;
  const lng2 = ((tileX + 1) / n) * 360 - 180;
  const lat1 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n))) * 180) / Math.PI;
  const lat2 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tileY + 1)) / n))) * 180) / Math.PI;

  const minLng = Math.min(lng1, lng2);
  const maxLng = Math.max(lng1, lng2);
  const minLat = Math.min(lat1, lat2);
  const maxLat = Math.max(lat1, lat2);

  const center = {
    lng: (minLng + maxLng) / 2,
    lat: (minLat + maxLat) / 2,
  };

  const polygon: [number, number][] = [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ];

  return {
    center,
    bounds: [minLng, minLat, maxLng, maxLat],
    polygon,
  };
}

/**
 * Finds the index of a quadkey column in query results (e.g. Ookla datasets).
 */
export function findQuadkeyColumnIndex(columns: string[]): number {
  const lowerCols = columns.map((c) => c.toLowerCase());
  const quadkeyNames = ["quadkey", "quad_key", "bing_quadkey", "tilekey", "tile_key"];
  for (const name of quadkeyNames) {
    const idx = lowerCols.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Finds the index of a bounding box column in query results (e.g. Overture Maps datasets).
 */
export function findBboxColumnIndex(columns: string[]): number {
  const lowerCols = columns.map((c) => c.toLowerCase());
  const bboxNames = ["bbox", "bounds", "boundingbox", "bounding_box"];
  for (const name of bboxNames) {
    const idx = lowerCols.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Attempts to parse a bounding box struct or array into center coordinates and bounds.
 */
export function parseBboxValue(val: any): { center: { lng: number; lat: number }; bounds: [number, number, number, number] } | null {
  if (val === null || val === undefined) return null;
  let minx: number | undefined;
  let miny: number | undefined;
  let maxx: number | undefined;
  let maxy: number | undefined;

  if (typeof val === "object") {
    minx = val.minx ?? val.minX ?? val.west ?? val.xmin;
    miny = val.miny ?? val.minY ?? val.south ?? val.ymin;
    maxx = val.maxx ?? val.maxX ?? val.east ?? val.xmax;
    maxy = val.maxy ?? val.maxY ?? val.north ?? val.ymax;

    if (Array.isArray(val) && val.length >= 4) {
      minx = Number(val[0]);
      miny = Number(val[1]);
      maxx = Number(val[2]);
      maxy = Number(val[3]);
    }
  } else if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return parseBboxValue(parsed);
    } catch {
      const parts = val.replace(/[\[\]{}]/g, "").split(",").map(Number);
      if (parts.length >= 4 && !parts.some(isNaN)) {
        return parseBboxValue(parts);
      }
    }
  }

  if (
    typeof minx === "number" && !isNaN(minx) &&
    typeof miny === "number" && !isNaN(miny) &&
    typeof maxx === "number" && !isNaN(maxx) &&
    typeof maxy === "number" && !isNaN(maxy)
  ) {
    if (Math.abs(minx) <= 180 && Math.abs(maxx) <= 180 && Math.abs(miny) <= 90 && Math.abs(maxy) <= 90) {
      return {
        center: {
          lng: (minx + maxx) / 2,
          lat: (miny + maxy) / 2,
        },
        bounds: [minx, miny, maxx, maxy],
      };
    }
  }
  return null;
}

/**
 * Checks whether a query result contains spatial information (coordinates, geometry, quadkeys, or bbox)
 * and can be viewed or added to the map.
 */
export function isSpatialQueryResult(data: QueryResultData): boolean {
  if (data.hasSpatialColumn) return true;
  if (data.spatialColumnName) return true;
  if (data.suggestedLayers && data.suggestedLayers.length > 0) return true;
  if (findCoordinateColumnIndices(data.columns) !== null) return true;
  if (findSpatialColumnIndex(data.columns, data.rows) !== -1) return true;
  if (findQuadkeyColumnIndex(data.columns) !== -1) return true;
  if (findBboxColumnIndex(data.columns) !== -1) return true;
  return false;
}

/**
 * Converts a QueryResultData into an array of GeoJSON Feature objects.
 */
export function convertQueryResultToFeatures(data: QueryResultData): any[] {
  const features: any[] = [];
  const coordCols = findCoordinateColumnIndices(data.columns);
  const spatialColIdx = data.spatialColumnName
    ? data.columns.indexOf(data.spatialColumnName)
    : findSpatialColumnIndex(data.columns, data.rows);
  const quadkeyColIdx = findQuadkeyColumnIndex(data.columns);
  const bboxColIdx = findBboxColumnIndex(data.columns);

  data.rows.forEach((row, rowIdx) => {
    let geom: any = null;
    let centerLng: number | undefined;
    let centerLat: number | undefined;

    // 1. Try geometry column (WKT, WKB hex, GeoJSON)
    if (spatialColIdx !== -1 && row[spatialColIdx] !== undefined) {
      geom = parseGeometryValue(row[spatialColIdx]);
    }

    // 2. Try coordinate columns
    if (!geom && coordCols) {
      const rawLng = row[coordCols.lngIdx];
      const rawLat = row[coordCols.latIdx];
      const lng = typeof rawLng === "number" ? rawLng : parseFloat(String(rawLng));
      const lat = typeof rawLat === "number" ? rawLat : parseFloat(String(rawLat));
      if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
        geom = { type: "Point", coordinates: [lng, lat] };
        centerLng = lng;
        centerLat = lat;
      }
    }

    // 3. Try QuadKey column (e.g. Ookla speedtest)
    if (!geom && quadkeyColIdx !== -1) {
      const qkVal = row[quadkeyColIdx];
      if (qkVal !== null && qkVal !== undefined) {
        const qkStr = String(qkVal).trim();
        if (/^[0-3]+$/.test(qkStr) && qkStr.length >= 1 && qkStr.length <= 30) {
          try {
            const { polygon, center } = quadKeyToBounds(qkStr);
            geom = { type: "Polygon", coordinates: [polygon] };
            centerLng = center.lng;
            centerLat = center.lat;
          } catch {}
        }
      }
    }

    // 4. Try Bounding Box column (e.g. Overture Maps bbox)
    if (!geom && bboxColIdx !== -1) {
      const bboxVal = row[bboxColIdx];
      const parsedBbox = parseBboxValue(bboxVal);
      if (parsedBbox) {
        centerLng = parsedBbox.center.lng;
        centerLat = parsedBbox.center.lat;
        const [minx, miny, maxx, maxy] = parsedBbox.bounds;
        if (Math.abs(minx - maxx) < 1e-7 && Math.abs(miny - maxy) < 1e-7) {
          geom = { type: "Point", coordinates: [minx, miny] };
        } else {
          geom = {
            type: "Polygon",
            coordinates: [
              [
                [minx, miny],
                [maxx, miny],
                [maxx, maxy],
                [minx, maxy],
                [minx, miny],
              ],
            ],
          };
        }
      }
    }

    if (geom) {
      if (centerLng === undefined || centerLat === undefined) {
        if (geom.type === "Point" && Array.isArray(geom.coordinates)) {
          centerLng = geom.coordinates[0];
          centerLat = geom.coordinates[1];
        } else {
          try {
            const centroid = turf.centroid(geom);
            if (centroid?.geometry?.coordinates) {
              centerLng = centroid.geometry.coordinates[0];
              centerLat = centroid.geometry.coordinates[1];
            }
          } catch {}
        }
      }

      const properties: any = {
        featureId: `${data.queryId}_${rowIdx}`,
      };
      if (centerLng !== undefined && centerLat !== undefined) {
        properties.center_lng = centerLng;
        properties.center_lat = centerLat;
        properties.lat = centerLat;
        properties.lng = centerLng;
      }
      data.columns.forEach((col, idx) => {
        if (idx !== spatialColIdx) {
          properties[col] = row[idx];
        }
      });

      // Convenience: If names is an Overture Maps struct with primary/common, expose as readable name
      if (!properties.name && properties.names && typeof properties.names === "object") {
        properties.name = properties.names.primary || properties.names.common || properties.names.default;
      }

      features.push({
        type: "Feature",
        geometry: geom,
        properties,
      });
    }
  });

  return features;
}

/**
 * Enriches a QueryResultData object with accurate spatial metadata and suggested visualization layers.
 * Guarantees that query results loaded from Supabase or memory have their spatial flags restored.
 */
export function enrichQueryResultWithSpatial(data: QueryResultData): QueryResultData {
  const coordCols = findCoordinateColumnIndices(data.columns);
  const spatialColIdx = findSpatialColumnIndex(data.columns, data.rows);

  const hasSpatial =
    data.hasSpatialColumn ||
    coordCols !== null ||
    spatialColIdx !== -1 ||
    findQuadkeyColumnIndex(data.columns) !== -1 ||
    findBboxColumnIndex(data.columns) !== -1;

  let spatialColName = data.spatialColumnName;
  if (!spatialColName && spatialColIdx !== -1) {
    spatialColName = data.columns[spatialColIdx];
  }

  let suggestedLayers = data.suggestedLayers;
  if (!suggestedLayers || suggestedLayers.length === 0) {
    const dummyTabularData = {
      queryId: data.queryId,
      queryText: data.queryText,
      columns: data.columns,
      rows: data.rows,
      rowCount: data.rowCount,
      totalRowCount: data.totalRowCount,
      truncated: data.truncated,
      executionTimeMs: data.executionTimeMs,
      toolName: data.toolName,
      timestamp: data.timestamp,
      hasSpatialColumn: hasSpatial,
      spatialColumnName: spatialColName,
    };
    try {
      const generated = suggestVisualizationLayers(dummyTabularData as any);
      if (generated && generated.length > 0) {
        suggestedLayers = generated;
      }
    } catch {
      // ignore suggestion failure
    }
  }

  return {
    ...data,
    hasSpatialColumn: hasSpatial,
    spatialColumnName: spatialColName,
    suggestedLayers,
  };
}
