import { NextRequest, NextResponse } from "next/server";
import { globalSessionService } from "../../route";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  try {
    const { shareId } = await params;
    
    // Decode shareId to get userId and sessionId
    const decoded = Buffer.from(shareId, "base64").toString("utf-8");
    const [userId, sessionId] = decoded.split("|");
    
    if (!userId || !sessionId) {
      return NextResponse.json({ error: "Invalid share link" }, { status: 400 });
    }

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
            });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      title: session.state?.title || "Shared Chat",
      messages,
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
