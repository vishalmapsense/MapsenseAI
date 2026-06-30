import { NextResponse } from "next/server";
import { getClientToolsAsMCP } from "@/config/clientTools";

export async function GET() {
  const tools = getClientToolsAsMCP();
  return NextResponse.json({ tools });
}
