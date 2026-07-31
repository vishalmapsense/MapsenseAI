import { NextRequest, NextResponse } from "next/server";
import { globalSessionService } from "../route";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const userId = user.email || user.id;

    const response = await globalSessionService.listSessions({
      appName: "MapsenseADK",
      userId,
      order: "desc",
    });

    const sessions = (response.sessions || []).map((s: any) => ({
      id: s.id,
      title: s.state?.title || `Chat ${s.id.slice(-6)}`,
      updatedAt: s.lastUpdateTime || Date.now(),
    }));

    return NextResponse.json({ success: true, sessions });
  } catch (error: any) {
    console.error("[ADK Sessions List Error]", error);
    return NextResponse.json(
      { error: error.message || "Failed to list sessions" },
      { status: 500 }
    );
  }
}
