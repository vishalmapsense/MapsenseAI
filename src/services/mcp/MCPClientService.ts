/**
 * MCP Client Service — Factory / Selector
 * ─────────────────────────────────────────────────────────────
 * UI layer sirf is service se baat karta hai.
 * Andar kaun sa adapter use ho raha hai — UI ko koi farak nahi.
 *
 * Switch karna: mcp.config.ts → ACTIVE_MCP_PROVIDER
 * ─────────────────────────────────────────────────────────────
 */

import { ACTIVE_MCP_PROVIDER } from "@/config/mcp.config";
import type { MCPAdapter } from "@/types/mcp.types";
import { MapboxMCPAdapter } from "./adapters/MapboxMCPAdapter";
import { BackendMCPAdapter } from "./adapters/BackendMCPAdapter";

function createMCPAdapter(): MCPAdapter {
  switch (ACTIVE_MCP_PROVIDER) {
    case "mapbox":
      return new MapboxMCPAdapter();
    case "backend":
      return new BackendMCPAdapter();
    default:
      throw new Error(`Unknown MCP provider: ${ACTIVE_MCP_PROVIDER}`);
  }
}

// Singleton instance — ek hi adapter banta hai per session
let _adapter: MCPAdapter | null = null;

export function getMCPAdapter(): MCPAdapter {
  if (!_adapter) {
    _adapter = createMCPAdapter();
  }
  return _adapter;
}

// Testing ya hot-switch ke liye adapter reset karo
export function resetMCPAdapter(): void {
  _adapter = null;
}
