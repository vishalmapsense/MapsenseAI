/**
 * Next.js API Route — MCP Proxy
 * ─────────────────────────────────────────────────────────────
 * Ye route browser aur local stdio MCP process ke beech bridge hai.
 *
 * Flow:
 *  Browser (ChatInput)
 *    → POST /api/mcp
 *    → Spawn child_process (node dist/index.js)
 *    → JSON-RPC over stdin/stdout
 *    → Response wapas browser ko
 *
 * Jab backend MCP ready ho:
 *  Sirf ACTIVE_MCP_PROVIDER = "backend" karo in mcp.config.ts
 *  Ye route automatically BackendMCPHandler use karega.
 * ─────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_MCP_PROVIDER } from "@/config/mcp.config";
import { MCPProxyRequest, MCPProxyResponse } from "@/types/mcp.types";
import { handleMapboxMCPRequest } from "./handlers/mapboxHandler";
import { handleBackendMCPRequest } from "./handlers/backendHandler";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: MCPProxyRequest = await req.json();

    let result: MCPProxyResponse;

    switch (ACTIVE_MCP_PROVIDER) {
      case "mapbox":
        result = await handleMapboxMCPRequest(body);
        break;
      case "backend":
        result = await handleBackendMCPRequest(body);
        break;
      default:
        result = { success: false, error: `Unknown MCP provider: ${ACTIVE_MCP_PROVIDER}` };
    }

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[MCP Proxy] Error:", message);
    return NextResponse.json(
      { success: false, error: message } satisfies MCPProxyResponse,
      { status: 500 }
    );
  }
}
