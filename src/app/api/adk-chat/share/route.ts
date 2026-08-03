import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { globalSessionService } from "../route";

export async function POST(req: NextRequest) {
  try {
    const { sessionId, title } = await req.json();
    
    if (!sessionId) {
      return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.email || user.id;

    // Verify the session actually belongs to this user
    const session = await globalSessionService.getSession({
      appName: "MapsenseADK",
      userId,
      sessionId,
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Check if it's already shared
    const { data: existingShare, error: fetchError } = await supabase
      .from('shared_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 means no rows found
      throw fetchError;
    }

    if (existingShare) {
      // If already exists, just return it, ensuring it's public
      if (!existingShare.is_public) {
        await supabase
          .from('shared_sessions')
          .update({ is_public: true })
          .eq('share_token', existingShare.share_token);
      }
      return NextResponse.json({ success: true, shareToken: existingShare.share_token });
    }

    // Insert new share record
    const { data: newShare, error: insertError } = await supabase
      .from('shared_sessions')
      .insert({
        user_id: userId,
        session_id: sessionId,
        title: title || session.state?.title || "Shared Chat",
        is_public: true
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ success: true, shareToken: newShare.share_token });

  } catch (error: any) {
    console.error("❌ Error sharing session:", error);
    return NextResponse.json({ error: error.message || "Failed to share session" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.email || user.id;

    const { data: sharedSessions, error } = await supabase
      .from('shared_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, sharedSessions });
  } catch (error: any) {
    console.error("❌ Error fetching shared sessions:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch shared sessions" }, { status: 500 });
  }
}
