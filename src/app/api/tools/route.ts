import { NextResponse } from "next/server";
import { getClientToolsAsMCP } from "@/config/clientTools";
import { callMCPProcess } from "../mcp/handlers/mapboxHandler";

export async function GET() {
  try {
    const clientTools = getClientToolsAsMCP();
    
    // Fetch MCP tools
    const mcpResult: any = await callMCPProcess("tools/list");
    const mcpTools = mcpResult?.tools || [];
    
    return NextResponse.json({
      success: true,
      totalTools: clientTools.length + mcpTools.length,
      clientTools,
      mcpTools
    });
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      clientTools: getClientToolsAsMCP()
    }, { status: 500 });
  }
}
