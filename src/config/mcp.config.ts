/**
 * MCP Provider Configuration
 * ─────────────────────────────────────────────────────────────
 * Ye file ek single place hai jahan se aap MCP provider switch kar sakte ho.
 *
 * Currently active: "mapbox"  (local stdio process)
 * Future switch:    "backend" (apna backend MCP server)
 *
 * Sirf ACTIVE_MCP_PROVIDER ki value change karo — baaki sab automatic.
 * ─────────────────────────────────────────────────────────────
 */

export type MCPProvider = "mapbox" | "backend";

// ✅ Yahan switch karo jab apna backend ready ho
export const ACTIVE_MCP_PROVIDER: MCPProvider = "mapbox";

// ─── Mapbox MCP Config (stdio local process) ───────────────────
export const MAPBOX_MCP_CONFIG = {
  /**
   * Aapke local Mapbox MCP server ka built entrypoint path.
   * Isko apne machine ka actual path se replace karo.
   *
   * Example: "/Users/yourname/mapbox-mcp-server/dist/index.js"
   */
  serverScriptPath: process.env.MAPBOX_MCP_SCRIPT_PATH ?? "",

  /**
   * Mapbox secret token — environment variable se aana chahiye,
   * kabhi bhi source code mein hardcode mat karo!
   */
  accessToken: process.env.MAPBOX_SECRET_TOKEN ?? "",
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
