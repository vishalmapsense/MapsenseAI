import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

function getContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".parquet":
      return "application/vnd.apache.parquet";
    case ".geojson":
    case ".json":
      return "application/geo+json; charset=utf-8";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".sqlite":
    case ".db":
      return "application/vnd.sqlite3";
    default:
      return "application/octet-stream";
  }
}

export async function HEAD(req: Request) {
  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    if (!fs.existsSync(filePath)) {
      return new NextResponse(null, { status: 404 });
    }
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath);

    return new NextResponse(null, {
      status: 200,
      headers: {
        "Content-Length": String(stat.size),
        "Content-Type": getContentType(ext),
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("path");
  const remoteUrl = searchParams.get("url");

  // Handle remote URL proxy
  if (remoteUrl) {
    try {
      const response = await fetch(remoteUrl);
      if (!response.ok) {
        return NextResponse.json(
          { error: `Remote URL returned ${response.status}` },
          { status: response.status }
        );
      }
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") || "application/octet-stream";

      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err: any) {
      return NextResponse.json({ error: `Proxy fetch failed: ${err.message}` }, { status: 500 });
    }
  }

  // Handle local file proxy
  if (!filePath) {
    return NextResponse.json({ error: "Missing 'path' or 'url' parameter" }, { status: 400 });
  }

  try {
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: `File not found: ${filePath}` }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath);
    const nodeStream = fs.createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Length": String(stat.size),
        "Content-Type": getContentType(ext),
        "Content-Disposition": `inline; filename="${encodeURIComponent(path.basename(filePath))}"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    console.error("File proxy error:", err);
    return NextResponse.json({ error: `Failed to read file: ${err.message}` }, { status: 500 });
  }
}
