import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

/**
 * DELETE — Delete a specific layer by index for a session
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; layerIndex: string }> }
) {
  try {
    const { sessionId, layerIndex } = await params;
    const layerIdx = parseInt(layerIndex, 10);

    if (isNaN(layerIdx)) {
      return NextResponse.json({ error: "Invalid layer index" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.email || user.id;

    // Delete the specific layer
    const { error: deleteError } = await supabase
      .from("session_layers")
      .delete()
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("layer_index", layerIdx);

    if (deleteError) throw deleteError;

    // Re-index remaining layers to keep indices contiguous
    // Fetch remaining layers ordered by index
    const { data: remaining, error: fetchError } = await supabase
      .from("session_layers")
      .select("id, layer_index")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .order("layer_index", { ascending: true });

    if (fetchError) throw fetchError;

    // Update indices to be 0, 1, 2, ... (contiguous)
    if (remaining && remaining.length > 0) {
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].layer_index !== i) {
          await supabase
            .from("session_layers")
            .update({ layer_index: i })
            .eq("id", remaining[i].id);
        }
      }
    }

    return NextResponse.json({ success: true, message: `Layer ${layerIdx} deleted` });
  } catch (error: any) {
    console.error("[Layer DELETE Error]", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete layer" },
      { status: 500 }
    );
  }
}
