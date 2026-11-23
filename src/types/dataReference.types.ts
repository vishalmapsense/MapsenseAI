/**
 * Data Reference Types
 * ─────────────────────────────────────────────────────────────
 * Represents user data references available for SQL querying in
 * Client DuckDB (DuckDB-Wasm) or Backend DuckDB Agent.
 * ─────────────────────────────────────────────────────────────
 */

export type DataReferenceType = "map_layer" | "local_file" | "online_url";

export interface DataReference {
  id: string;
  name: string; // Display name, e.g. "india_okala_network"
  tableName: string; // Sanitized SQL table name, e.g. "india_okala_network"
  type: DataReferenceType;
  path?: string; // Local file path, e.g. "/Users/.../india_okala_network.geojson"
  url?: string; // Remote URL, e.g. "https://..."
  format?: "parquet" | "csv" | "geojson" | "json" | "sqlite" | "auto";
  sizeBytes?: number;
  featureCount?: number;
  loadedInDuckDB?: boolean;
}
