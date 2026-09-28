import { NextRequest, NextResponse } from "next/server";
import { globalSessionService } from "../../route";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { cleanMessageContent, isInternalOrEmptyMessage } from "@/utils/messageCleaner";

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

    const session = await globalSessionService.getSession({
      appName: "MapsenseADK",
      userId,
      sessionId,
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
                timestamp: event.timestamp || Date.now(),
              });
            }
          }
        }
      }
    }

    return NextResponse.json({ success: true, sessionId, messages });
  } catch (error: any) {
    console.error("[ADK Session History Error]", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch session history" },
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

    // Clean up any files stored in Supabase Storage
    try {
      let query = supabase.from("session_layers").select("geojson").eq("user_id", userId);
      if (sessionId !== "all") {
        query = query.eq("session_id", sessionId);
      }
      const { data: layers } = await query;
      const storagePaths = (layers || [])
        .filter((l: any) => l.geojson?._is_storage && l.geojson?._storage_path)
        .map((l: any) => l.geojson._storage_path);

      if (storagePaths.length > 0) {
        console.log(`[Session DELETE] 🗑️ Removing ${storagePaths.length} file(s) from Supabase Storage`);
        await supabase.storage.from("session-layers").remove(storagePaths);
      }
    } catch (cleanErr) {
      console.warn("[Session DELETE] Storage cleanup error:", cleanErr);
    }

    if (sessionId === "all") {
      // Delete layers for all sessions first
      const { error: layerDeleteError } = await supabase
        .from("session_layers")
        .delete()
        .eq("user_id", userId);
      if (layerDeleteError) console.error("Failed to delete all session layers:", layerDeleteError);

      // Fetch all sessions to delete them individually (ADK does not provide deleteAll)
      const response = await globalSessionService.listSessions({
        appName: "MapsenseADK",
        userId,
      });
      const sessions = response.sessions || [];
      for (const s of sessions) {
        await globalSessionService.deleteSession({
          appName: "MapsenseADK",
          userId,
          sessionId: s.id,
        });
      }
      return NextResponse.json({ success: true, message: "All sessions deleted" });
    } else {
      // Delete layers for this specific session
      const { error: layerDeleteError } = await supabase
        .from("session_layers")
        .delete()
        .eq("user_id", userId)
        .eq("session_id", sessionId);
      if (layerDeleteError) console.error("Failed to delete session layers:", layerDeleteError);

      await globalSessionService.deleteSession({
        appName: "MapsenseADK",
        userId,
        sessionId,
      });
      return NextResponse.json({ success: true, message: "Session deleted" });
    }
  } catch (error: any) {
    console.error(`[ADK Session Delete Error]`, error);
    return NextResponse.json(
      { error: error.message || "Failed to delete session" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const { title } = await req.json();

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.email || user.id;

    const session = await globalSessionService.getSession({
      appName: "MapsenseADK",
      userId,
      sessionId,
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await globalSessionService.appendEvent({
      session,
      event: {
        id: crypto.randomUUID(),
        invocationId: crypto.randomUUID(),
        timestamp: Date.now(),
        source: "system",
        actions: {
          stateDelta: { title }
        }
      } as any
    });

    // Also update the title in the shared_sessions table if this session was shared
    const { error: sharedError } = await supabase
      .from("shared_sessions")
      .update({ title })
      .eq("session_id", sessionId);

    if (sharedError) {
      console.warn("Failed to update shared session title:", sharedError);
    }

    return NextResponse.json({ success: true, title });
  } catch (error: any) {
    console.error(`[ADK Session Rename Error]`, error);
    return NextResponse.json(
      { error: error.message || "Failed to rename session" },
      { status: 500 }
    );
  }
}
