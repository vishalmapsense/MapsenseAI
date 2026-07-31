import { NextResponse } from "next/server";
import { getClientToolsAsMCP } from "@/config/clientTools";
import { callMCPProcess } from "../mcp/handlers/mapboxHandler";
import { getPlaygTools } from "../mcp/handlers/playgHandler";

export async function GET() {
  try {
    const clientTools = getClientToolsAsMCP();
    
    // Fetch Mapbox MCP tools
    const mcpResult: any = await callMCPProcess("tools/list");
    const mcpTools = mcpResult?.tools || [];
    
    // Fetch Playg MCP tools
    const playgResult: any = await getPlaygTools();
    const playgTools = playgResult?.tools || [];

    return NextResponse.json({
      success: true,
      totalTools: clientTools.length + mcpTools.length + playgTools.length,
      clientTools,
      mapboxTools: mcpTools,
      playgroundTools: playgTools
    });
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      clientTools: getClientToolsAsMCP()
    }, { status: 500 });
  }
}
