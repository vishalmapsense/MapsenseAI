/**
 * Client-Side DuckDB Service (DuckDB-Wasm)
 * ─────────────────────────────────────────────────────────────
 * Runs an in-memory DuckDB instance directly in the browser via Web Workers
 * and WebAssembly. Supports querying:
 * 1. Map Layers (useMapStore.mapFeatures)
 * 2. Local Files (via /api/file-proxy: .parquet, .csv, .geojson, .json)
 * 3. Remote URLs (.parquet, .csv, .geojson, .json)
 *
 * Automatically resolves and registers tables referenced in SQL queries.
 * ─────────────────────────────────────────────────────────────
 */

import type { QueryResultData } from "@/types/mcp.types";
import type { DataReference } from "@/types/dataReference.types";
import { suggestVisualizationLayers } from "@/agents/utils/layerSuggestionEngine";
import { useDataReferenceStore, sanitizeTableName, extractLayerTitle } from "@/stores/useDataReferenceStore";
import { useChatStore } from "@/stores/useChatStore";
import { enrichQueryResultWithSpatial } from "@/utils/spatialQueryHelper";
import * as turf from "@turf/turf";

function cleanValue(val: unknown): any {
  if (val === null || val === undefined) return null;
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number(val);
    }
    return val.toString();
  }
  if (val instanceof Date) return val.toISOString();
  if (val instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(val);
    } catch {
      return Array.from(val);
    }
  }
  if (typeof val === "object") {
    if (typeof (val as any).toJSON === "function") {
      return (val as any).toJSON();
    }
  }
  return val;
}

export class ClientDuckDBService {
  private db: any = null;
  private conn: any = null;
  private worker: Worker | null = null;
  private isInitializing: boolean = false;
  private initPromise: Promise<void> | null = null;
  private syncedFeaturesHash: string = "";
  private loadedTables: Set<string> = new Set(["map_features", "layers"]);
  private registeredFileNames: Set<string> = new Set();

  private spatialLoaded: boolean = false;
  private spatialLoadingPromise: Promise<boolean> | null = null;

  /**
   * Installs and loads the spatial extension in DuckDB-Wasm for ST_* functions.
   */
  public async loadSpatialExtension(): Promise<boolean> {
    if (this.spatialLoaded) return true;
    if (this.spatialLoadingPromise) return this.spatialLoadingPromise;

    this.spatialLoadingPromise = (async () => {
      try {
        if (!this.conn) {
          await this.init();
        }
        console.log("🦆 [ClientDuckDB] Installing & loading spatial extension in DuckDB-Wasm...");
        try {
          await this.conn.query("INSTALL spatial;");
        } catch (installErr: any) {
          console.log("🦆 [ClientDuckDB] INSTALL spatial note:", installErr?.message || installErr);
        }
        await this.conn.query("LOAD spatial;");
        this.spatialLoaded = true;
        console.log("🦆 [ClientDuckDB] Spatial extension loaded successfully.");
        return true;
      } catch (err: any) {
        console.warn("⚠️ [ClientDuckDB] Could not load spatial extension:", err);
        return false;
      } finally {
        this.spatialLoadingPromise = null;
      }
    })();

    return this.spatialLoadingPromise;
  }

  /**
   * Initializes the DuckDB-Wasm instance in the browser.
   * Uses jsDelivr bundles and an inline Blob worker.
   */
  public async init(): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("ClientDuckDB can only be initialized in the browser.");
    }

    if (this.db && this.conn) {
      return;
    }

    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = (async () => {
      try {
        console.log("🦆 [ClientDuckDB] Initializing DuckDB-Wasm in browser...");
        const duckdb = await import("@duckdb/duckdb-wasm");

        // Select the optimal bundle (WASM / SIMD / Exception Handling)
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

        if (!bundle || !bundle.mainWorker) {
          throw new Error("Could not find a suitable DuckDB-Wasm bundle for this browser.");
        }

        // Web Workers require same-origin; wrap CDN worker script in a Blob
        const workerScript = `importScripts("${bundle.mainWorker}");`;
        const workerBlob = new Blob([workerScript], { type: "text/javascript" });
        const workerUrl = URL.createObjectURL(workerBlob);

        this.worker = new Worker(workerUrl);
        const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
        this.db = new duckdb.AsyncDuckDB(logger, this.worker);

        await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        URL.revokeObjectURL(workerUrl);

        this.conn = await this.db.connect();
        console.log("🦆 [ClientDuckDB] DuckDB-Wasm initialized successfully.");

        // Automatically load spatial extension in background
        this.loadSpatialExtension().catch((err) => {
          console.warn("⚠️ [ClientDuckDB] Background spatial load notice:", err);
        });
      } catch (err) {
        console.error("❌ [ClientDuckDB] Failed to initialize DuckDB-Wasm:", err);
        this.db = null;
        this.conn = null;
        throw err;
      } finally {
        this.isInitializing = false;
      }
    })();

    return this.initPromise;
  }

  /**
   * Synchronizes current mapFeatures from useMapStore into DuckDB-Wasm in-memory tables.
   */
  public async syncMapLayers(mapFeatures: any[]): Promise<void> {
    if (!mapFeatures || mapFeatures.length === 0) return;

    await this.init();

    const featuresHash = `${mapFeatures.length}_${JSON.stringify(
      mapFeatures.map((f) => ({
        count: f.features?.length || f.geojson?.features?.length || (f.type === "Feature" ? 1 : 0),
        title: f.title || f.name || f.properties?.title || f.properties?.name || "",
      }))
    )}`;

    if (this.syncedFeaturesHash === featuresHash) {
      return;
    }

    try {
      const allFeatureRows: any[] = [];
      const layerMetaRows: any[] = [];

      for (let layerIdx = 0; layerIdx < mapFeatures.length; layerIdx++) {
        const layerObj = mapFeatures[layerIdx];
        const layerTitle = extractLayerTitle(layerObj, layerIdx);
        const layerId = layerObj.properties?.layerId || layerObj.id || `layer_${layerIdx}`;
        const tableName = sanitizeTableName(layerTitle);
        const altTableName = `layer_${layerIdx + 1}`;

        const features: any[] = Array.isArray(layerObj.features)
          ? layerObj.features
          : Array.isArray(layerObj.geojson?.features)
          ? layerObj.geojson.features
          : layerObj.type === "Feature"
          ? [layerObj]
          : layerObj.geojson?.type === "Feature"
          ? [layerObj.geojson]
          : [];

        const layerSpecificRows: any[] = [];

        features.forEach((feat: any, featIdx: number) => {
          if (!feat) return;
          const props = feat.properties || {};
          const geom = feat.geometry || (feat.type && feat.coordinates ? feat : null);
          let geomStr: string | null = null;
          let lng: number | null = null;
          let lat: number | null = null;
          let areaSqMeters: number | null = null;
          let areaSqKm: number | null = null;
          let perimeterKm: number | null = null;
          let centerLng: number | null = null;
          let centerLat: number | null = null;

          if (geom) {
            geomStr = JSON.stringify(geom);
            if (geom.type === "Point" && Array.isArray(geom.coordinates)) {
              lng = Number(geom.coordinates[0]);
              lat = Number(geom.coordinates[1]);
              centerLng = lng;
              centerLat = lat;
            } else {
              // Polygon, MultiPolygon, LineString, MultiLineString, etc.
              try {
                const centroid = turf.centroid(feat);
                if (centroid?.geometry?.coordinates) {
                  centerLng = Number(centroid.geometry.coordinates[0].toFixed(6));
                  centerLat = Number(centroid.geometry.coordinates[1].toFixed(6));
                  // Crucial: assign representative lng and lat so queries on lat/lng never return NULL for polygons
                  lng = centerLng;
                  lat = centerLat;
                }
              } catch {
                // ignore centroid error
              }

              if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
                try {
                  const areaVal = turf.area(feat);
                  if (!isNaN(areaVal) && areaVal > 0) {
                    areaSqMeters = Number(areaVal.toFixed(2));
                    areaSqKm = Number((areaVal / 1_000_000).toFixed(4));
                  }
                  const lenVal = turf.length(feat, { units: "kilometers" });
                  if (!isNaN(lenVal) && lenVal > 0) {
                    perimeterKm = Number(lenVal.toFixed(3));
                  }
                } catch {
                  // ignore geometry calc error
                }
              } else if (geom.type === "LineString" || geom.type === "MultiLineString") {
                try {
                  const lenVal = turf.length(feat, { units: "kilometers" });
                  if (!isNaN(lenVal) && lenVal > 0) {
                    perimeterKm = Number(lenVal.toFixed(3));
                  }
                } catch {
                  // ignore
                }
              }
            }
          }

          const centroidWkt =
            centerLng !== null && centerLat !== null ? `POINT(${centerLng} ${centerLat})` : null;

          const rowData: Record<string, any> = {
            id: props.id || props.featureId || feat.id || `${layerIdx}_${featIdx}`,
            ...props,
            ...(lng !== null && lat !== null ? { lng, lat } : {}),
            ...(centerLng !== null && centerLat !== null
              ? {
                  center_lng: centerLng,
                  center_lat: centerLat,
                  centroid_lng: centerLng,
                  centroid_lat: centerLat,
                  centroid: centroidWkt,
                }
              : {}),
            ...(areaSqMeters !== null
              ? {
                  area_sq_meters: areaSqMeters,
                  area_sq_km: areaSqKm,
                  perimeter_km: perimeterKm,
                }
              : {}),
            geometry: geomStr,
            __layer_name: tableName,
            __layer_title: layerTitle,
            __layer_alias: altTableName,
            __layer_id: layerId,
          };

          allFeatureRows.push(rowData);
          layerSpecificRows.push(rowData);
        });

        layerMetaRows.push({
          layer_id: layerId,
          table_name: tableName,
          layer_title: layerTitle,
          feature_count: features.length,
        });

        if (layerSpecificRows.length > 0) {
          const fileName = `${tableName}_${Date.now()}.json`;
          await this.db.registerFileText(fileName, JSON.stringify(layerSpecificRows));
          await this.conn.query(
            `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${fileName}', ignore_errors=true, union_by_name=true);`
          );
          this.loadedTables.add(tableName);

          // Create alias table with "layer_1", "layer_2", etc.
          if (tableName !== altTableName) {
            await this.conn.query(
              `CREATE OR REPLACE TABLE "${altTableName}" AS SELECT * FROM "${tableName}";`
            );
            this.loadedTables.add(altTableName);
          }

          // Also alias if layerTitle sanitized differs from tableName and altTableName
          const sanitizedTitle = sanitizeTableName(layerTitle);
          if (sanitizedTitle !== tableName && sanitizedTitle !== altTableName) {
            await this.conn.query(
              `CREATE OR REPLACE TABLE "${sanitizedTitle}" AS SELECT * FROM "${tableName}";`
            );
            this.loadedTables.add(sanitizedTitle);
          }

          // Also alias if layerObj.name exists and differs
          if (layerObj.name && typeof layerObj.name === "string") {
            const sanitizedObjName = sanitizeTableName(layerObj.name);
            if (
              sanitizedObjName !== tableName &&
              sanitizedObjName !== altTableName &&
              sanitizedObjName !== sanitizedTitle
            ) {
              await this.conn.query(
                `CREATE OR REPLACE TABLE "${sanitizedObjName}" AS SELECT * FROM "${tableName}";`
              );
              this.loadedTables.add(sanitizedObjName);
            }
          }
        }
      }

      if (allFeatureRows.length > 0) {
        const masterFile = `all_map_features_${Date.now()}.json`;
        await this.db.registerFileText(masterFile, JSON.stringify(allFeatureRows));
        await this.conn.query(
          `CREATE OR REPLACE TABLE map_features AS SELECT * FROM read_json_auto('${masterFile}', ignore_errors=true, union_by_name=true);`
        );
        this.loadedTables.add("map_features");
      }

      if (layerMetaRows.length > 0) {
        const metaFile = `layers_meta_${Date.now()}.json`;
        await this.db.registerFileText(metaFile, JSON.stringify(layerMetaRows));
        await this.conn.query(
          `CREATE OR REPLACE TABLE layers AS SELECT * FROM read_json_auto('${metaFile}', ignore_errors=true, union_by_name=true);`
        );
        this.loadedTables.add("layers");
      }

      this.syncedFeaturesHash = featuresHash;
      useDataReferenceStore.getState().syncFromMapFeatures(mapFeatures);
      console.log(`🦆 [ClientDuckDB] Synced ${allFeatureRows.length} features into map_features table.`);
    } catch (err) {
      console.warn("⚠️ [ClientDuckDB] Layer sync warning:", err);
    }
  }

  /**
   * Registers and loads a local file via /api/file-proxy into a DuckDB table.
   */
  public async registerLocalFile(filePath: string, customTableName?: string): Promise<string> {
    await this.init();

    const rawName = filePath.split("/").pop() || "data_file";
    const tableName = customTableName || sanitizeTableName(rawName);

    if (this.loadedTables.has(tableName)) {
      console.log(`🦆 [ClientDuckDB] Table "${tableName}" already loaded.`);
      return tableName;
    }

    console.log(`🦆 [ClientDuckDB] Loading local file into DuckDB: ${filePath} → "${tableName}"`);

    try {
      const res = await fetch(`/api/file-proxy?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        throw new Error(`Failed to stream local file (${res.status}): ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const ext = rawName.split(".").pop()?.toLowerCase() || "data";
      const virtualFileName = `${tableName}_${Date.now()}.${ext}`;

      await this.db.registerFileBuffer(virtualFileName, new Uint8Array(arrayBuffer));
      this.registeredFileNames.add(virtualFileName);

      if (ext === "parquet") {
        await this.conn.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_parquet('${virtualFileName}');`);
      } else if (ext === "csv") {
        await this.conn.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${virtualFileName}');`);
      } else if (ext === "geojson" || ext === "json") {
        try {
          // Attempt GeoJSON FeatureCollection unnesting so properties become top-level columns
          await this.conn.query(`
            CREATE OR REPLACE TABLE "${tableName}" AS 
            SELECT 
              f.properties.*,
              to_json(f.geometry) AS geometry
            FROM (
              SELECT unnest(features) AS f FROM read_json_auto('${virtualFileName}')
            );
          `);
        } catch (nestErr) {
          // Fallback to standard read_json_auto if not a FeatureCollection
          await this.conn.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${virtualFileName}');`);
        }
      } else {
        await this.conn.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${virtualFileName}');`);
      }

      this.loadedTables.add(tableName);
      console.log(`✅ [ClientDuckDB] Table "${tableName}" successfully created in DuckDB-Wasm.`);
      return tableName;
    } catch (err) {
      console.error(`❌ [ClientDuckDB] Failed to load local file "${filePath}":`, err);
      throw err;
    }
  }

  /**
   * Registers and loads a remote URL into a DuckDB table.
   */
  public async registerRemoteUrl(url: string, customTableName?: string): Promise<string> {
    await this.init();

    const rawName = url.split("/").pop()?.split("?")[0] || "remote_data";
    const tableName = customTableName || sanitizeTableName(rawName);

    if (this.loadedTables.has(tableName)) {
      return tableName;
    }

    console.log(`🦆 [ClientDuckDB] Loading remote URL into DuckDB: ${url} → "${tableName}"`);

    try {
      const ext = rawName.split(".").pop()?.toLowerCase() || "parquet";
      const proxyUrl = `/api/file-proxy?url=${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch remote dataset (${res.status}): ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const virtualFileName = `${tableName}_${Date.now()}.${ext}`;

      await this.db.registerFileBuffer(virtualFileName, new Uint8Array(arrayBuffer));
      this.registeredFileNames.add(virtualFileName);

      if (ext === "parquet") {
        await this.conn.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_parquet('${virtualFileName}');`);
      } else if (ext === "csv") {
        await this.conn.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${virtualFileName}');`);
      } else if (ext === "geojson" || ext === "json") {
        try {
          await this.conn.query(`
            CREATE OR REPLACE TABLE "${tableName}" AS 
            SELECT 
              f.properties.*,
              to_json(f.geometry) AS geometry
            FROM (
              SELECT unnest(features) AS f FROM read_json_auto('${virtualFileName}')
            );
          `);
        } catch {
          await this.conn.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${virtualFileName}');`);
        }
      } else {
        await this.conn.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${virtualFileName}');`);
      }

      this.loadedTables.add(tableName);
      console.log(`✅ [ClientDuckDB] Table "${tableName}" successfully created from URL.`);
      return tableName;
    } catch (err) {
      console.error(`❌ [ClientDuckDB] Failed to load remote URL "${url}":`, err);
      throw err;
    }
  }

  /**
   * Registers any DataReference (local file, remote URL, or map layer).
   */
  public async registerDataReference(ref: DataReference): Promise<string> {
    if (ref.type === "local_file" && ref.path) {
      const t = await this.registerLocalFile(ref.path, ref.tableName);
      useDataReferenceStore.getState().markLoaded(ref.id, true);
      return t;
    }
    if (ref.type === "online_url" && ref.url) {
      const t = await this.registerRemoteUrl(ref.url, ref.tableName);
      useDataReferenceStore.getState().markLoaded(ref.id, true);
      return t;
    }
    return ref.tableName;
  }

  /**
   * Scans a SQL query for referenced tables or file paths, and ensures
   * they are loaded into DuckDB before execution.
   */
  private async resolveAndLoadTables(queryText: string): Promise<string> {
    // Sync any files from chat attachments first
    try {
      const chatFiles = useChatStore.getState().selectedFilesForChat;
      if (chatFiles && chatFiles.length > 0) {
        useDataReferenceStore.getState().syncFromAttachedFiles(chatFiles);
      }
    } catch {
      // ignore
    }

    const tableRegex = /(?:FROM|JOIN)\s+(?:["']([a-zA-Z0-9_\-.]+)["']|([a-zA-Z0-9_\-]+))/gi;
    let match;
    const tableNamesToEnsure = new Set<string>();

    while ((match = tableRegex.exec(queryText)) !== null) {
      const name = match[1] || match[2];
      if (name && !name.startsWith("(")) {
        tableNamesToEnsure.add(name);
      }
    }

    const availableRefs = useDataReferenceStore.getState().references;

    for (const rawName of tableNamesToEnsure) {
      const sanitized = sanitizeTableName(rawName);

      // If already loaded in DuckDB, skip
      if (this.loadedTables.has(rawName) || this.loadedTables.has(sanitized)) {
        continue;
      }

      // Find matching DataReference
      let matchingRef = availableRefs.find(
        (r) =>
          r.tableName.toLowerCase() === rawName.toLowerCase() ||
          r.tableName.toLowerCase() === sanitized.toLowerCase() ||
          r.name.toLowerCase() === rawName.toLowerCase() ||
          (r.path && r.path.toLowerCase().includes(rawName.toLowerCase()))
      );

      if (!matchingRef) {
        // Check chat files
        const chatFiles = useChatStore.getState().selectedFilesForChat;
        const matchingChatFile = chatFiles.find(
          (p: string) =>
            p.toLowerCase().includes(rawName.toLowerCase()) ||
            sanitizeTableName(p).toLowerCase() === sanitized.toLowerCase()
        );
        if (matchingChatFile) {
          matchingRef = useDataReferenceStore.getState().addReference({
            name: rawName,
            path: matchingChatFile,
            type: "local_file",
          });
        } else {
          // Check map features for layer matching rawName or sanitized
          try {
            const { useMapStore } = await import("@/stores/useMapStore");
            const mapFeatures = useMapStore.getState().mapFeatures;
            const found = mapFeatures.some((l, idx) => {
              const t = extractLayerTitle(l, idx);
              return (
                t.toLowerCase() === rawName.toLowerCase() ||
                sanitizeTableName(t).toLowerCase() === sanitized.toLowerCase() ||
                `layer_${idx + 1}` === rawName.toLowerCase()
              );
            });
            if (found) {
              console.log(`🦆 [ClientDuckDB] Auto-syncing mapFeatures for missing layer table "${rawName}"...`);
              await this.syncMapLayers(mapFeatures);
            }
          } catch {
            // ignore
          }
        }
      }

      if (matchingRef) {
        console.log(`🦆 [ClientDuckDB] Auto-resolving missing table "${rawName}" via reference:`, matchingRef.name);
        try {
          await this.registerDataReference(matchingRef);
        } catch (e) {
          console.warn(`Could not auto-register reference ${matchingRef.name}:`, e);
        }
      }
    }

    return queryText;
  }

  /**
   * Executes a SQL query directly in client-side DuckDB-Wasm.
   * Automatically resolves missing tables from registered data references.
   */
  public async runQuery(queryText: string): Promise<QueryResultData> {
    await this.init();

    const startTime = performance.now();
    const queryId = `client_duckdb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    console.log(`🦆 [ClientDuckDB] Running query: ${queryText}`);

    // Step 1: Pre-resolve any table names in the query
    let preparedQuery = await this.resolveAndLoadTables(queryText);

    // Step 2: Normalize spatial function calls in client DuckDB-Wasm
    // DuckDB-Wasm in browser lacks the native spatial extension, but all geometries
    // already have precomputed columns: centroid, center_lat, center_lng, lat, lng, area_sq_km, area_sq_meters, perimeter_km.
    preparedQuery = preparedQuery
      .replace(/ST_AsText\s*\(\s*ST_Centroid\s*\(\s*ST_GeomFromGeoJSON\s*\(\s*geometry\s*\)\s*\)\s*\)/gi, "centroid")
      .replace(/ST_Centroid\s*\(\s*ST_GeomFromGeoJSON\s*\(\s*geometry\s*\)\s*\)/gi, "centroid")
      .replace(/ST_Centroid\s*\(\s*geometry\s*\)/gi, "centroid")
      .replace(/ST_Area_Spheroid\s*\(\s*ST_GeomFromGeoJSON\s*\(\s*geometry\s*\)\s*\)\s*\/\s*1000000(?:\.0)?/gi, "area_sq_km")
      .replace(/ST_Area_Spheroid\s*\(\s*ST_GeomFromGeoJSON\s*\(\s*geometry\s*\)\s*\)/gi, "area_sq_meters")
      .replace(/ST_Area\s*\(\s*ST_GeomFromGeoJSON\s*\(\s*geometry\s*\)\s*\)/gi, "area_sq_meters")
      .replace(/ST_Area\s*\(\s*geometry\s*\)/gi, "area_sq_meters")
      .replace(/ST_Length\s*\(\s*ST_GeomFromGeoJSON\s*\(\s*geometry\s*\)\s*\)/gi, "perimeter_km")
      .replace(/ST_Length\s*\(\s*geometry\s*\)/gi, "perimeter_km");

    // Step 3: Handle __layer_name matching in WHERE clauses so that whether the LLM queried
    // by tableName, raw layerTitle, or alias, it matches regardless of casing or formatting.
    preparedQuery = preparedQuery.replace(
      /__layer_name\s*=\s*(['"][^'"]+['"])/gi,
      (_match, val) => {
        const cleanVal = val.replace(/['"]/g, "").trim();
        const sanitized = sanitizeTableName(cleanVal);
        return `(__layer_name = '${sanitized}' OR __layer_title = ${val} OR __layer_alias = '${sanitized}' OR LOWER(__layer_name) = LOWER('${sanitized}') OR LOWER(__layer_title) = LOWER(${val}))`;
      }
    );

    // Step 4: If query references remaining spatial functions or keywords, ensure spatial extension is loaded
    if (/(\bst_[a-z0-9_]+\b|\bspatial\b)/i.test(preparedQuery)) {
      await this.loadSpatialExtension();
    }

    try {
      const statements = preparedQuery
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      let arrowTable: any = null;

      for (const statement of statements) {
        if (/^INSTALL\s+spatial/i.test(statement)) {
          await this.loadSpatialExtension();
          continue;
        }
        if (/^LOAD\s+spatial/i.test(statement)) {
          await this.loadSpatialExtension();
          continue;
        }
        arrowTable = await this.conn.query(statement);
      }

      const executionTimeMs = Math.round(performance.now() - startTime);

      if (!arrowTable || !arrowTable.schema) {
        return {
          queryId,
          queryText,
          columns: ["status"],
          rows: [["Command executed successfully"]],
          rowCount: 1,
          totalRowCount: 1,
          truncated: false,
          executionTimeMs,
          toolName: "client_duckdb",
          timestamp: Date.now(),
          hasSpatialColumn: false,
        };
      }

      const columns: string[] = arrowTable.schema.fields.map((f: any) => f.name);
      const totalRowCount = arrowTable.numRows || 0;
      const countToFetch = totalRowCount;
      const rows: any[][] = [];

      for (let i = 0; i < countToFetch; i++) {
        const record = arrowTable.get(i);
        const row: any[] = [];
        for (const col of columns) {
          row.push(cleanValue(record ? record[col] : null));
        }
        rows.push(row);
      }

      const baseResult: QueryResultData = {
        queryId,
        queryText,
        columns,
        rows,
        rowCount: rows.length,
        totalRowCount,
        truncated: false,
        executionTimeMs,
        toolName: "client_duckdb",
        timestamp: Date.now(),
        hasSpatialColumn: false,
      };

      const result = enrichQueryResultWithSpatial(baseResult);

      console.log(`✅ [ClientDuckDB] Query completed in ${executionTimeMs}ms, ${rows.length} rows (hasSpatial: ${result.hasSpatialColumn}, col: ${result.spatialColumnName || 'none'}).`);
      return result;
    } catch (err: any) {
      console.error(`❌ [ClientDuckDB] Query failed:`, err);
      const errMsg = err?.message || String(err);
      if (errMsg.includes("spatial extension") || errMsg.includes("st_distance")) {
        throw new Error(
          `DuckDB Spatial Error: ${errMsg}. Note: Coordinates (lng, lat) can also be used directly: SQRT(POW(lng - target_lng, 2) + POW(lat - target_lat, 2)).`
        );
      }
      throw new Error(`Client DuckDB Error: ${errMsg}`);
    }
  }

  /**
   * Returns list of user-accessible table names currently in DuckDB-Wasm.
   */
  public async getTableNames(): Promise<string[]> {
    try {
      await this.init();
      const res = await this.conn.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY table_name;"
      );
      const tables: string[] = [];
      for (let i = 0; i < (res.numRows || 0); i++) {
        const r = res.get(i);
        if (r && r.table_name) tables.push(String(r.table_name));
      }
      return tables;
    } catch {
      return [];
    }
  }
}

// Global browser singleton
export const clientDuckDB = new ClientDuckDBService();
