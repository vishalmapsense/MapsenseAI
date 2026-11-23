import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing 'url' parameter" }, { status: 400 });
  }

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch from target URL. Status: ${response.status}` },
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type");
    const data = await response.text();

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType || "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    console.error("Proxy error:", error);
    return NextResponse.json({ error: "Failed to proxy request", details: error.message }, { status: 500 });
  }
}
