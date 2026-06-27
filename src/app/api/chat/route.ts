import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { callMCPProcess } from "../mcp/handlers/mapboxHandler";
import { MCPTool, MCPToolCall } from "@/types/mcp.types";
import { convertMCPToolsToGeminiTools } from "@/lib/mcpToGemini";

export async function POST(req: NextRequest) {
  try {
    const { messages, modelId, provider, apiKey } = await req.json();

    if (!messages || !modelId || !provider || !apiKey) {
      return NextResponse.json(
        { error: "Missing required fields (messages, modelId, provider, apiKey)" },
        { status: 400 }
      );
    }

    if (provider !== "google") {
      return NextResponse.json(
        { error: "Currently, only Google Gemini models are supported by the backend." },
        { status: 400 }
      );
    }

    // 1. Fetch available tools from Mapbox MCP
    const toolsResult = await callMCPProcess("tools/list") as { tools: MCPTool[] };
    const mcpTools = toolsResult.tools;
    const geminiTools = convertMCPToolsToGeminiTools(mcpTools);

    // 2. Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelId,
      tools: [{ functionDeclarations: geminiTools }],
      systemInstruction: "You are MapsenseAI, a helpful geospatial assistant. You have access to Mapbox tools to find places, analyze locations, and compute travel times. Always use the provided tools if the user asks about locations, places, or navigation. Provide clear, concise, and human-friendly responses.",
    });

    // 3. Format history for Gemini (excluding the last user message)
    const history = messages.slice(0, -1).map((m: any) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });

    const lastMessage = messages[messages.length - 1].content;
    const toolCallsMade: MCPToolCall[] = [];

    // 4. Send message to Gemini
    let result = await chat.sendMessage([{ text: lastMessage }]);
    let functionCalls = result.response.functionCalls();

    // 5. Handle Tool Calls
    while (functionCalls && functionCalls.length > 0) {
      const functionResponses = [];

      for (const call of functionCalls) {
        console.log(`[Gemini] Calling tool: ${call.name}`, call.args);
        
        try {
          // Execute tool via MCP
          const toolResult = await callMCPProcess("tools/call", {
            name: call.name,
            arguments: call.args,
          });

          toolCallsMade.push({
            toolName: call.name,
            arguments: call.args as Record<string, unknown>,
            result: toolResult,
          });

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: toolResult as object,
            },
          });
        } catch (error: any) {
          console.error(`[Gemini] Tool call failed: ${call.name}`, error);
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { error: error.message },
            },
          });
        }
      }

      // Send the tool results back to Gemini to get the final text response
      result = await chat.sendMessage(functionResponses);
      functionCalls = result.response.functionCalls();
    }

    // 6. Final response
    const finalContent = result.response.text();

    return NextResponse.json({
      content: finalContent,
      toolCalls: toolCallsMade,
    });

  } catch (error: any) {
    console.error("[Chat API Error]", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
