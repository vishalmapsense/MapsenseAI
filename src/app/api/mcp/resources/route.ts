/**
 * MCP Resources API Endpoint
 * ─────────────────────────────────────────────────────────────
 * GeoJSON resource store ka REST interface.
 *
 * Endpoints:
 *   GET /api/mcp/resources
 *     → Sab stored resources ki list (monitoring ke liye)
 *
 *   GET /api/mcp/resources?uri=geojson://resource/xxx
 *     → Specific resource ka full GeoJSON data
 *
 * Use Cases:
 *   1. Debugging — dekho ki kya-kya store mein hai
 *   2. Future: Client-side direct resource fetch (bina LLM ke)
 *   3. Resource size monitoring
 * ─────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";
import { listResources, readGeoJSON, isResourceURI } from "@/lib/geoJsonResourceStore";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const uri = searchParams.get("uri");

  // ── Specific resource fetch ────────────────────────────────
  if (uri) {
    if (!isResourceURI(uri)) {
      return NextResponse.json(
        { error: "Invalid resource URI format. Expected: geojson://resource/<id>" },
        { status: 400 }
      );
    }

    const data = readGeoJSON(uri);

    if (!data) {
      return NextResponse.json(
        { error: "Resource not found or expired (TTL: 5 minutes)" },
        { status: 404 }
      );
    }

    return NextResponse.json({ uri, data });
  }

  // ── List all resources ─────────────────────────────────────
  const resources = listResources();

  return NextResponse.json({
    count: resources.length,
    resources: resources.map((r) => ({
      ...r,
      sizeKB: (r.sizeBytes / 1024).toFixed(1),
      expiresInMs: r.expiresAt - Date.now(),
    })),
  });
}
