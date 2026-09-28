/**
 * Client Tools — DuckDB (In-Browser DuckDB-Wasm)
 * ─────────────────────────────────────────────────────────────
 * Client-side DuckDB SQL execution for fast, low-latency queries on
 * loaded map layers, visible features, counts, filters, top-N, and aggregations.
 * ─────────────────────────────────────────────────────────────
 */
import type { ClientToolDefinition } from "@/config/clientTools/types";

export const DUCKDB_CLIENT_TOOLS: ClientToolDefinition[] = [
  {
    type: "function",
    name: "run_client_duckdb_query",
    description:
      "Execute a fast DuckDB SQL query directly in the browser (client-side DuckDB-Wasm). " +
      "Use this for SMALL and NORMAL queries: counting features, filtering ('WHERE rating > 4'), " +
      "sorting ('ORDER BY ... DESC LIMIT 10'), top-N rankings, simple aggregations (COUNT, SUM, AVG, MIN, MAX), " +
      "and grouping on datasets or layers already visible on the map. " +
      "Available in-memory tables include 'map_features' (all active features), 'layers' (layer metadata), " +
      "or sanitized layer names (e.g. 'schools', 'delhi_boundary'). " +
      "'map_features' includes 'id', 'lng', 'lat', 'geometry' (GeoJSON string), '__layer_name', plus all feature properties. " +
      "Spatial extension functions (ST_Point, ST_Distance, ST_Within) are supported, and coordinates (lng, lat) can also be used directly. " +
      "DO NOT use this tool for massive multi-gigabyte datasets or complex backend-only file operations — " +
      "use the backend run_duck_db_queries tool for heavy workloads.",
    parameters: {
      type: "object",
      properties: {
        queryText: {
          type: "string",
          description:
            "The SQL query to execute in client DuckDB-Wasm. Example: 'SELECT COUNT(*) FROM map_features;' or 'SELECT name, rating FROM map_features ORDER BY rating DESC LIMIT 5;'",
        },
        description: {
          type: "string",
          description: "Brief explanation of what this query does for the user.",
        },
        applyToMap: {
          type: "boolean",
          description:
            "Set to true if this query filters, creates, or classifies map features and you want the result to be directly updated or displayed as an active layer on the map (e.g. 'filter karke map par dikhao').",
        },
        layerTitle: {
          type: "string",
          description:
            "Optional title/label for the map layer when applyToMap is true (e.g. 'South States', 'High Rating Restaurants').",
        },
      },
      required: ["queryText"],
      additionalProperties: false,
    },
    strict: false,
  },
];
