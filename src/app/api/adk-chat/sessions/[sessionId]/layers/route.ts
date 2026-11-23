import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

/**
 * GET — Fetch all layers for a session
 * POST — Save a new layer (after successful map render)
 * DELETE — Delete all layers for a session
 */

const STORAGE_BUCKET = "session-layers";
const STORAGE_THRESHOLD_BYTES = 3 * 1024 * 1024; // 3 MB: layers larger than this go to Storage

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

    // Resolve any layers stored in Supabase Storage
    const resolvedLayers = await Promise.all(
      (layers || []).map(async (layer: any) => {
        if (layer.geojson?._is_storage && layer.geojson?._storage_path) {
          try {
            const { data: fileData, error: downloadError } = await supabase.storage
              .from(STORAGE_BUCKET)
              .download(layer.geojson._storage_path);

            if (!downloadError && fileData) {
              const text = await fileData.text();
              return { ...layer, geojson: JSON.parse(text) };
            }
          } catch (storageErr) {
            console.warn(`[Layers GET] Failed to fetch layer ${layer.layer_index} from storage:`, storageErr);
          }
        }
        return layer;
      })
    );

    return NextResponse.json({ success: true, layers: resolvedLayers });
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
    let body: any;
    try {
      body = await req.json();
    } catch (parseErr: any) {
      console.warn("[Layers POST] Failed to parse JSON body:", parseErr.message);
      return NextResponse.json(
        { error: "Layer data exceeds server payload size limit (50MB) or is malformed." },
        { status: 413 }
      );
    }

    const { layerIndex, layerName, geojson } = body || {};

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

    // If payload is large (> 3 MB), store in Supabase Storage to bypass PostgREST / Postgres JSONB limits
    const geojsonStr = typeof geojson === "string" ? geojson : JSON.stringify(geojson);
    let layerDataToSave = geojson;

    if (geojsonStr.length > STORAGE_THRESHOLD_BYTES) {
      const storagePath = `${userId}/${sessionId}/layer_${layerIndex}.json`;
      console.log(`[Layers POST] 📦 Storing layer ${layerIndex} (${(geojsonStr.length / 1048576).toFixed(1)} MB) in Supabase Storage: ${storagePath}`);

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, geojsonStr, {
          contentType: "application/json",
          upsert: true,
        });

      if (!uploadError) {
        layerDataToSave = {
          _is_storage: true,
          _storage_path: storagePath,
          _size_bytes: geojsonStr.length,
          type: "FeatureCollection",
          features: [],
        };
      } else {
        console.warn("[Layers POST] Storage upload warning (fallback to table insert):", uploadError.message);
      }
    }

    // Upsert lightweight record into session_layers table
    const { error } = await supabase
      .from("session_layers")
      .upsert(
        {
          user_id: userId,
          session_id: sessionId,
          layer_index: layerIndex,
          layer_name: layerName || "Layer",
          geojson: layerDataToSave,
        },
        { onConflict: "user_id,session_id,layer_index" }
      );

    if (error) throw error;

    return NextResponse.json({ success: true, message: "Layer saved successfully" });
  } catch (error: any) {
    console.error("[Layers POST Error]", error);
    const isCapacityIssue =
      error.message?.includes("Bad Gateway") ||
      error.message?.includes("statement timeout") ||
      error.code === "57014" ||
      error.status === 502 ||
      error.status === 504 ||
      error.details?.includes("statement timeout");

    const message = isCapacityIssue
      ? "Cloud database capacity limit exceeded. Layer is safely stored in your active session."
      : error.message || "Failed to save layer";

    return NextResponse.json(
      { error: message, isCapacityIssue: !!isCapacityIssue },
      { status: isCapacityIssue ? 413 : 500 }
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

    // Clean up any files in Supabase Storage for this session
    try {
      const { data: layers } = await supabase
        .from("session_layers")
        .select("geojson")
        .eq("user_id", userId)
        .eq("session_id", sessionId);

      const storagePaths = (layers || [])
        .filter((l: any) => l.geojson?._is_storage && l.geojson?._storage_path)
        .map((l: any) => l.geojson._storage_path);

      if (storagePaths.length > 0) {
        await supabase.storage.from(STORAGE_BUCKET).remove(storagePaths);
      }
    } catch (cleanErr) {
      console.warn("[Layers DELETE] Storage cleanup error:", cleanErr);
    }

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
