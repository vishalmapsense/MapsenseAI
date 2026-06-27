/**
 * Backend MCP Handler — Future Implementation
 * ─────────────────────────────────────────────────────────────
 * Jab aapka apna backend MCP server ready ho:
 *
 * 1. mcp.config.ts mein ACTIVE_MCP_PROVIDER = "backend" karo
 * 2. BACKEND_MCP_URL environment variable set karo
 * 3. Is file mein actual implementation add karo
 *
 * Abhi ye placeholder hai jo ek clear error deta hai.
 * ─────────────────────────────────────────────────────────────
 */

import { BACKEND_MCP_CONFIG } from "@/config/mcp.config";
import { MCPProxyRequest, MCPProxyResponse } from "@/types/mcp.types";

export async function handleBackendMCPRequest(
  body: MCPProxyRequest
): Promise<MCPProxyResponse> {
  const { baseUrl, apiKey } = BACKEND_MCP_CONFIG;

  if (!baseUrl) {
    return {
      success: false,
      error:
        "BACKEND_MCP_URL is not configured. " +
        "Set it in .env.local and implement this handler.",
    };
  }

  try {
    // ── TODO: Replace with your actual backend MCP protocol ──
    //
    // Example for a REST-based backend:
    //
    // const response = await fetch(`${baseUrl}/mcp/${body.action}`, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    //   },
    //   body: JSON.stringify(body),
    // });
    // const data = await response.json();
    // return { success: response.ok, data, error: !response.ok ? data.error : undefined };
    //
    // ─────────────────────────────────────────────────────────

    void body; // suppress unused warning
    void apiKey;

    return {
      success: false,
      error: "Backend MCP handler is not implemented yet. See backendHandler.ts for instructions.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}
