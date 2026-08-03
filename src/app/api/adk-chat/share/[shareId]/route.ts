import { NextRequest, NextResponse } from "next/server";
import { globalSessionService } from "../../route";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

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
      title: shareRecord.title || session.state?.title || "Shared Chat",
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
