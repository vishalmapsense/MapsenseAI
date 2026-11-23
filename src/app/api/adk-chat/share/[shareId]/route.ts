import { NextRequest, NextResponse } from "next/server";
import { globalSessionService } from "../../route";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { cleanMessageContent, isInternalOrEmptyMessage } from "@/utils/messageCleaner";
import { enrichQueryResultWithSpatial } from "@/utils/spatialQueryHelper";
import type { QueryResultData } from "@/types/mcp.types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  try {
    const { shareId } = await params;
    
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data: shareRecord, error: shareError } = await supabase
      .from('shared_sessions')
      .select('*')
      .eq('share_token', shareId)
      .single();

    if (shareError || !shareRecord) {
      return NextResponse.json({ error: "Invalid or expired share link" }, { status: 404 });
    }

    if (!shareRecord.is_public) {
      return NextResponse.json({ error: "This chat is no longer public" }, { status: 403 });
    }

    const session = await globalSessionService.getSession({
      appName: "MapsenseADK",
      userId: shareRecord.user_id,
      sessionId: shareRecord.session_id,
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const messages: any[] = [];
    if (session.events && Array.isArray(session.events)) {
      for (const event of session.events) {
        if (event.content && event.content.parts) {
          let text = "";
          for (const part of event.content.parts) {
            if (part.text) text += part.text;
          }
          if (text) {
            const role = event.author === "user" ? "user" : "assistant";
            const cleaned = cleanMessageContent(text);
            if (cleaned && !isInternalOrEmptyMessage(role, text)) {
              messages.push({
                id: event.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                role,
                content: cleaned,
              });
            }
          }
        }
      }
    }

    // Fetch layers for the shared session (resolving storage files if needed)
    const { data: layerRecords } = await supabase
      .from("session_layers")
      .select("geojson, layer_index")
      .eq("user_id", shareRecord.user_id)
      .eq("session_id", shareRecord.session_id)
      .order("layer_index", { ascending: true });

    const layers = await Promise.all(
      (layerRecords || []).map(async (l: any) => {
        if (l.geojson?._is_storage && l.geojson?._storage_path) {
          try {
            const { data: fileData, error: downloadErr } = await supabase.storage
              .from("session-layers")
              .download(l.geojson._storage_path);
            if (!downloadErr && fileData) {
              const text = await fileData.text();
              return JSON.parse(text);
            }
          } catch (e) {
            console.warn("[Share API] Could not resolve storage layer:", e);
          }
        }
        return l.geojson;
      })
    );

    // Fetch query results for the shared session
    console.log("[Share API] Fetching query results for session_id:", shareRecord.session_id);
    const { data: queryResultRecords, error: queryResultError } = await supabase
      .from("query_results")
      .select("*")
      .eq("session_id", shareRecord.session_id)
      .order("timestamp", { ascending: false });

    console.log("[Share API] Query Results fetched:", queryResultRecords?.length, "error:", queryResultError);

    let finalQueryResults = queryResultRecords;
    if (queryResultError) {
      if (queryResultError.code === "42P01" || queryResultError.code === "PGRST204") {
        console.warn("query_results table does not exist yet. Returning empty query results for shared session.");
        finalQueryResults = [];
      } else {
        throw queryResultError;
      }
    }

    const queryResults = (finalQueryResults || []).map((row: any) => {
      const baseResult: QueryResultData = {
        queryId: row.query_id,
        queryText: row.query_text,
        columns: row.columns,
        rows: row.rows,
        rowCount: row.row_count,
        totalRowCount: row.total_row_count,
        truncated: row.truncated,
        executionTimeMs: row.execution_time_ms,
        toolName: row.tool_name,
        timestamp: row.timestamp,
        hasSpatialColumn: row.has_spatial_column,
        spatialColumnName: row.spatial_column_name,
      };
      return enrichQueryResultWithSpatial(baseResult);
    });

    return NextResponse.json({
      success: true,
      title: shareRecord.title || session.state?.title || "Shared Chat",
      messages,
      layers,
      queryResults,
      updatedAt: session.lastUpdateTime || Date.now()
    });

  } catch (error: any) {
    console.error("❌ Error fetching shared session:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch shared session" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  try {
    const { shareId } = await params;
    const { is_public } = await req.json();

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.email || user.id;

    // Verify ownership
    const { data: existingShare, error: fetchError } = await supabase
      .from('shared_sessions')
      .select('*')
      .eq('share_token', shareId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingShare) {
      return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from('shared_sessions')
      .update({ is_public })
      .eq('share_token', shareId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, is_public });
  } catch (error: any) {
    console.error("❌ Error updating shared session:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update shared session" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  try {
    const { shareId } = await params;
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.email || user.id;

    // Verify ownership and delete
    const { error: deleteError } = await supabase
      .from('shared_sessions')
      .delete()
      .eq('share_token', shareId)
      .eq('user_id', userId);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("❌ Error deleting shared session:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete shared session" },
      { status: 500 }
    );
  }
}
