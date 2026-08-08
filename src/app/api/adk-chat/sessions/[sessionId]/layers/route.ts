import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

/**
 * GET — Fetch all layers for a session
 * POST — Save a new layer (after successful map render)
 * DELETE — Delete all layers for a session
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.email || user.id;

    const { data: layers, error } = await supabase
      .from("session_layers")
      .select("*")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .order("layer_index", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, layers: layers || [] });
  } catch (error: any) {
    console.error("[Layers GET Error]", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch layers" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const { layerIndex, layerName, geojson } = await req.json();

    if (layerIndex === undefined || !geojson) {
      return NextResponse.json(
        { error: "Missing layerIndex or geojson" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.email || user.id;

    // Upsert: if layer_index already exists for this session, update it
    const { data, error } = await supabase
      .from("session_layers")
      .upsert(
        {
          user_id: userId,
          session_id: sessionId,
          layer_index: layerIndex,
          layer_name: layerName || "Layer",
          geojson,
        },
        { onConflict: "user_id,session_id,layer_index" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, layer: data });
  } catch (error: any) {
    console.error("[Layers POST Error]", error);
    return NextResponse.json(
      { error: error.message || "Failed to save layer" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.email || user.id;

    const { error } = await supabase
      .from("session_layers")
      .delete()
      .eq("user_id", userId)
      .eq("session_id", sessionId);

    if (error) throw error;

    return NextResponse.json({ success: true, message: "All layers deleted" });
  } catch (error: any) {
    console.error("[Layers DELETE Error]", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete layers" },
      { status: 500 }
    );
  }
}
