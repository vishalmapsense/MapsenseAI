/**
 * MCP Provider Configuration
 * ─────────────────────────────────────────────────────────────
 * Ye file ek single place hai jahan se aap MCP provider switch kar sakte ho.
 *
 * Currently active: "mapbox"  (hosted Mapbox MCP endpoint via StreamableHTTP)
 * Future switch:    "backend" (apna backend MCP server)
 *
 * Sirf ACTIVE_MCP_PROVIDER ki value change karo — baaki sab automatic.
 * ─────────────────────────────────────────────────────────────
 */

export type MCPProvider = "mapbox" | "backend";

// ✅ Yahan switch karo jab apna backend ready ho
export const ACTIVE_MCP_PROVIDER: MCPProvider = "mapbox";

// ─── Mapbox MCP Config (Hosted Endpoint & Stdio Fallback) ──────
export const MAPBOX_MCP_CONFIG = {
  /**
   * Hosted Mapbox MCP endpoint URL.
   * Default: "https://mcp.mapbox.com/mcp"
   */
  hostedUrl: process.env.MAPBOX_MCP_URL ?? "https://mcp.mapbox.com/mcp",

  /**
   * Local Mapbox MCP server built entrypoint path (e.g. index.js).
   * Used as fallback or for local offline development.
   */
  serverScriptPath: process.env.MAPBOX_MCP_SCRIPT_PATH ?? "",

  /**
   * Mapbox access/secret token.
   */
  accessToken:
    process.env.MAPBOX_SECRET_TOKEN ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    "",
} as const;

// ─── Playg MCP Config (Hosted Endpoint & Stdio Fallback) ───────
export const PLAYG_MCP_CONFIG = {
  /**
   * Hosted Playg MCP endpoint URL (e.g. "https://playg-mcp-server.vercel.app/").
   */
  hostedUrl:
    process.env.PLAYG_MCP_URL ?? "https://playg-mcp-server.vercel.app/",

  /**
   * Local Playg MCP server built entrypoint path (e.g. build/index.js).
   * Used as fallback or for local offline development.
   */
  serverScriptPath: process.env.PLAYG_MCP_SCRIPT_PATH ?? "",

  apiBase: process.env.PLAYG_API_BASE ?? "http://localhost:8000",
  redisUrl:
    process.env.PLAYG_REDIS_URL ||
    process.env.REDIS_URL ||
    "redis://localhost:6379",
  bearerToken:
    process.env.PLAYG_BEARER_TOKEN || process.env.BEARER_TOKEN || "",
} as const;

// ─── Backend MCP Config (future) ──────────────────────────────
export const BACKEND_MCP_CONFIG = {
  /**
   * Aapke backend MCP server ka HTTP endpoint.
   * Jab backend ready ho tab yahan URL daal do.
   */
  baseUrl: process.env.BACKEND_MCP_URL ?? "http://localhost:4000",
  apiKey: process.env.BACKEND_MCP_API_KEY ?? "",
} as const;
