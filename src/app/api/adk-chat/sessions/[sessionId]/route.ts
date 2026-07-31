import { NextRequest, NextResponse } from "next/server";
import { globalSessionService } from "../../route";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

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
            messages.push({
              id: event.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: event.author === "user" ? "user" : "assistant",
              content: text,
              timestamp: event.timestamp || Date.now(),
            });
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

    if (sessionId === "all") {
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

    return NextResponse.json({ success: true, title });
  } catch (error: any) {
    console.error(`[ADK Session Rename Error]`, error);
    return NextResponse.json(
      { error: error.message || "Failed to rename session" },
      { status: 500 }
    );
  }
}
