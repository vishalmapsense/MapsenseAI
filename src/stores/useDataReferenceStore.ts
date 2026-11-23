import { create } from "zustand";
import type { DataReference, DataReferenceType } from "@/types/dataReference.types";

export function sanitizeTableName(name: string): string {
  const base = name.split("/").pop() || name;
  const noExt = base.replace(/\.[^/.]+$/, "");
  const sanitized = noExt
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return sanitized || "data_table";
}

export function extractLayerTitle(layerObj: any, layerIdx = 0): string {
  if (!layerObj) return `layer_${layerIdx + 1}`;
  const features = Array.isArray(layerObj.features)
    ? layerObj.features
    : layerObj.type === "Feature"
    ? [layerObj]
    : [];
  const firstProps = features[0]?.properties || {};
  const rootProps = layerObj.properties || {};

  const resolved =
    layerObj.title ||
    layerObj.name ||
    layerObj.layerName ||
    rootProps.title ||
    rootProps.name ||
    rootProps.label ||
    firstProps.title ||
    firstProps.name ||
    firstProps.layerName ||
    firstProps.officeName ||
    firstProps.ntaname ||
    firstProps.boro_name ||
    firstProps.instruction ||
    firstProps.dtname ||
    firstProps.label ||
    `layer_${layerIdx + 1}`;

  return String(resolved);
}

export function detectFormat(pathOrUrl: string): "parquet" | "csv" | "geojson" | "json" | "auto" {
  const lower = pathOrUrl.toLowerCase();
  if (lower.endsWith(".parquet")) return "parquet";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".geojson")) return "geojson";
  if (lower.endsWith(".json")) return "json";
  return "auto";
}

interface DataReferenceState {
  references: DataReference[];
  activeReferenceId: string | null;

  addReference: (ref: Omit<DataReference, "id" | "tableName" | "name"> & { id?: string; tableName?: string; name?: string }) => DataReference;
  removeReference: (id: string) => void;
  setActiveReference: (id: string | null) => void;
  markLoaded: (id: string, loaded?: boolean) => void;

  syncFromMapFeatures: (mapFeatures: any[]) => void;
  syncFromAttachedFiles: (filePaths: string[]) => void;
  syncFromUrls: (urls: string[]) => void;

  getReferenceByTable: (tableName: string) => DataReference | undefined;
}

export const useDataReferenceStore = create<DataReferenceState>((set, get) => ({
  references: [
    {
      id: "map_features_ref",
      name: "Map Features (All)",
      tableName: "map_features",
      type: "map_layer",
      format: "geojson",
      loadedInDuckDB: true,
    },
  ],
  activeReferenceId: "map_features_ref",

  addReference: (partialRef) => {
    const existing = get().references.find(
      (r) =>
        (partialRef.path && r.path === partialRef.path) ||
        (partialRef.url && r.url === partialRef.url) ||
        (partialRef.tableName && r.tableName === partialRef.tableName)
    );

    if (existing) {
      return existing;
    }

    const rawName = partialRef.name || partialRef.path?.split("/").pop() || partialRef.url?.split("/").pop() || "dataset";
    const tableName = partialRef.tableName || sanitizeTableName(rawName);
    const id = partialRef.id || `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const format = partialRef.format || (partialRef.path ? detectFormat(partialRef.path) : partialRef.url ? detectFormat(partialRef.url) : "auto");

    const newRef: DataReference = {
      id,
      name: rawName.replace(/\.[^/.]+$/, ""),
      tableName,
      type: partialRef.type,
      path: partialRef.path,
      url: partialRef.url,
      format,
      sizeBytes: partialRef.sizeBytes,
      featureCount: partialRef.featureCount,
      loadedInDuckDB: false,
    };

    set((state) => ({
      references: [...state.references, newRef],
      activeReferenceId: newRef.id,
    }));

    return newRef;
  },

  removeReference: (id) => {
    set((state) => ({
      references: state.references.filter((r) => r.id !== id),
      activeReferenceId: state.activeReferenceId === id ? "map_features_ref" : state.activeReferenceId,
    }));
  },

  setActiveReference: (id) => {
    set({ activeReferenceId: id });
  },

  markLoaded: (id, loaded = true) => {
    set((state) => ({
      references: state.references.map((r) => (r.id === id ? { ...r, loadedInDuckDB: loaded } : r)),
    }));
  },

  syncFromMapFeatures: (mapFeatures) => {
    if (!mapFeatures || mapFeatures.length === 0) return;

    set((state) => {
      const nonMapRefs = state.references.filter((r) => r.type !== "map_layer" || r.id === "map_features_ref");
      const mapLayerRefs: DataReference[] = mapFeatures.map((featObj, idx) => {
        const title = extractLayerTitle(featObj, idx);
        const tableName = sanitizeTableName(title);
        const count = Array.isArray(featObj.features) ? featObj.features.length : featObj.type === "Feature" ? 1 : 0;

        return {
          id: `layer_${featObj.properties?.layerId || idx}`,
          name: title,
          tableName,
          type: "map_layer",
          format: "geojson",
          featureCount: count,
          loadedInDuckDB: true,
        };
      });

      return {
        references: [...nonMapRefs, ...mapLayerRefs],
      };
    });
  },

  syncFromAttachedFiles: (filePaths) => {
    if (!filePaths || filePaths.length === 0) return;

    filePaths.forEach((path) => {
      const trimmed = path.trim();
      if (!trimmed) return;
      get().addReference({
        name: trimmed.split("/").pop() || "local_file",
        path: trimmed,
        type: "local_file",
        format: detectFormat(trimmed),
      });
    });
  },

  syncFromUrls: (urls) => {
    if (!urls || urls.length === 0) return;

    urls.forEach((url) => {
      const trimmed = url.trim();
      if (!trimmed) return;
      get().addReference({
        name: trimmed.split("/").pop() || "online_data",
        url: trimmed,
        type: "online_url",
        format: detectFormat(trimmed),
      });
    });
  },

  getReferenceByTable: (tableName) => {
    const sanitized = sanitizeTableName(tableName);
    return get().references.find(
      (r) =>
        r.tableName.toLowerCase() === tableName.toLowerCase() ||
        r.tableName.toLowerCase() === sanitized.toLowerCase() ||
        r.name.toLowerCase() === tableName.toLowerCase()
    );
  },
}));
