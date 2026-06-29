import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType, Schema } from "@google/generative-ai";
import { callMCPProcess } from "../mcp/handlers/mapboxHandler";
import { MCPTool, MCPToolCall } from "@/types/mcp.types";
import { convertMCPToolsToGeminiTools } from "@/lib/mcpToGemini";

// ─── Helper: GeoJSON extract karo tool result se ─────────────────────────────

/**
 * MCP tool result (ya resource data) se GeoJSON (FeatureCollection) extract karo.
 * Handles:
 * 1. Standard FeatureCollection/Feature
 * 2. Mapbox DirectionsResponse (routes[0].geometry ko Feature mein convert karta hai)
 */
function extractGeoJSON(data: any): any | null {
  if (!data) return null;
  
  if (["FeatureCollection", "Feature"].includes(data.type)) {
    return data;
  }
  
  // Handle Mapbox DirectionsResponse
  if (data.routes && Array.isArray(data.routes) && data.routes.length > 0) {
    const route = data.routes[0];
    if (route.geometry) {
      return {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: route.geometry,
            properties: {
              distance: route.distance,
              duration: route.duration,
            },
          },
        ],
      };
    }
  }
  return null;
}

function extractGeoJSONFromToolResult(res: unknown): unknown | null {
  if (!res || typeof res !== "object") return null;
  const r = res as Record<string, unknown>;

  // Primary path: structuredContent
  const sc = extractGeoJSON(r.structuredContent);
  if (sc) return sc;

  // Fallback: content[].text mein JSON string
  if (r.content && Array.isArray(r.content)) {
    for (const block of r.content as any[]) {
      if (block.type === "text" && block.text) {
        try {
          const parsed = JSON.parse(block.text);
          const pd = extractGeoJSON(parsed);
          if (pd) return pd;
        } catch {
          /* not JSON */
        }
      }
    }
  }

  return null;
}

/**
 * Text block mein agar "mapbox://temp/..." jaisa URI hai to extract karo.
 */
function extractResourceUriFromText(text: string): string | null {
  if (!text) return null;
  const match = text.match(/(mapbox:\/\/temp\/[a-zA-Z0-9-]+)/);
  return match ? match[1] : null;
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { messages, modelId, provider, apiKey, userLocation } = await req.json();

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

    // 2. Define Response Schema for Gemini
    const responseSchema: Schema = {
      type: SchemaType.OBJECT,
      properties: {
        text: {
          type: SchemaType.STRING,
          description: "Human-readable AI response in Markdown.",
        },
        commands: {
          type: SchemaType.ARRAY,
          description: "Array of map visualization commands. Use ADD_LAYER when geospatial data should be drawn on the map.",
          items: {
            type: SchemaType.OBJECT,
            properties: {
              type: {
                type: SchemaType.STRING,
                description: "Command type: ADD_LAYER, FIT_BOUNDS, or CLEAR_MAP",
              },
            },
            required: ["type"]
          }
        }
      },
      required: ["text", "commands"]
    };

    // 3. Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelId,
      tools: [{ functionDeclarations: geminiTools }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
      systemInstruction: `You are MapsenseAI, a helpful geospatial assistant with Mapbox MCP tools.
Your response MUST be valid JSON with "text" and "commands" fields.

RULES FOR COMMANDS:
- If the user's query involves locating places, searching locations, navigation, routing, or any geospatial analysis, you MUST call the appropriate tool AND include an ADD_LAYER command followed by a FIT_BOUNDS command.
- If the user asks a general question (e.g. "what is GIS?"), return an empty commands array.
- You do NOT need to include GeoJSON data in the commands. The backend will inject the actual data from tool results automatically.

IMPORTANT — RESOURCE URIs:
- If a tool result says "Resource URI: mapbox://temp/...", it means the full geometry was too large and was stored as a temporary resource.
- This is a SUCCESSFUL result. Treat it exactly as if you got the full coordinates.
- Output ADD_LAYER normally. The backend will automatically fetch the URI and inject the geometry.

Supported commands:
- ADD_LAYER: Tells the frontend to draw geospatial data on the map.
- FIT_BOUNDS: Tells the frontend to zoom to fit the drawn data.
- CLEAR_MAP: Tells the frontend to clear all drawn data from the map.

Example response for a location query:
{ "text": "I found Kanpur...", "commands": [{"type": "ADD_LAYER"}, {"type": "FIT_BOUNDS"}] }`,
    });

    // 4. Format history for Gemini (excluding the last user message)
    const history = messages.slice(0, -1).map((m: any) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });

    let lastMessage = messages[messages.length - 1].content;
    
    // Inject user location context silently if available
    if (userLocation && userLocation.lat && userLocation.lng) {
      lastMessage = `[System Context: The user's current GPS location is Latitude: ${userLocation.lat}, Longitude: ${userLocation.lng}. Use this if they ask for things "near me" or "around here".]\n\n${lastMessage}`;
    }

    const toolCallsMade: MCPToolCall[] = [];

    // 5. Send message to Gemini
    let result = await chat.sendMessage([{ text: lastMessage }]);
    let functionCalls = result.response.functionCalls();

    // 6. Handle Tool Calls (loop until no more function calls)
    while (functionCalls && functionCalls.length > 0) {
      const functionResponses = [];

      for (const call of functionCalls) {
        console.log(`[Gemini] Calling tool: ${call.name}`, call.args);
        
        try {
          // Execute tool via MCP
          const rawToolResult = await callMCPProcess("tools/call", {
            name: call.name,
            arguments: call.args,
          });

          // Check if Mapbox returned a resource URI (for large payloads > 50KB)
          let resourceUri = undefined;
          if (rawToolResult && (rawToolResult as any).content) {
            for (const block of (rawToolResult as any).content) {
              if (block.type === "text") {
                const match = extractResourceUriFromText(block.text);
                if (match) resourceUri = match;
              }
            }
          }

          if (resourceUri) {
            console.log(`[Chat Route] Detected Mapbox Resource URI: ${resourceUri}`);
          }

          toolCallsMade.push({
            toolName: call.name,
            arguments: call.args as Record<string, unknown>,
            result: rawToolResult,
            resourceUri,
          });

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: rawToolResult as object, // Pass Mapbox's own LLM-safe summary
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

    // 7. Parse the LLM's structured JSON response
    const rawContent = result.response.text();
    let finalJson;
    try {
      finalJson = JSON.parse(rawContent);
    } catch (e) {
      // Fallback if model somehow doesn't return valid JSON
      finalJson = {
        text: rawContent,
        commands: []
      };
    }

    // 8. POST-PROCESSING: Inject actual GeoJSON from tool results into ADD_LAYER commands.
    if (finalJson.commands && Array.isArray(finalJson.commands) && toolCallsMade.length > 0) {
      const collectedGeoJSON: unknown[] = [];

      for (const tc of toolCallsMade) {
        if (tc.resourceUri) {
          // ── LARGE PAYLOAD: resolve from Mapbox MCP Server ──────────────────
          try {
            console.log(`[Post-Processing] Fetching full geometry from ${tc.resourceUri}...`);
            const resolved: any = await callMCPProcess("resources/read", { uri: tc.resourceUri });
            
            if (resolved && resolved.contents && resolved.contents.length > 0) {
              const textData = resolved.contents[0].text;
              const parsed = JSON.parse(textData);
              const geoJSON = extractGeoJSON(parsed);
              if (geoJSON) {
                console.log(`[Post-Processing] Successfully extracted full GeoJSON from resource.`);
                collectedGeoJSON.push(geoJSON);
              }
            }
          } catch (err: any) {
            console.error(`[Post-Processing] Failed to read resource ${tc.resourceUri}:`, err.message);
          }
        } else {
          // ── SMALL PAYLOAD: extract directly from tool result ────────────
          const geoJSON = extractGeoJSONFromToolResult(tc.result);
          if (geoJSON) {
            console.log(`[Post-Processing] Extracted GeoJSON directly from tool result.`);
            collectedGeoJSON.push(geoJSON);
          }
        }
      }

      // Inject collected GeoJSON into ADD_LAYER commands
      let geoIndex = 0;
      finalJson.commands = finalJson.commands.map((cmd: any) => {
        if (cmd.type === "ADD_LAYER" && geoIndex < collectedGeoJSON.length) {
          return { ...cmd, payload: collectedGeoJSON[geoIndex++] };
        }
        return cmd;
      });

      // If there are extra GeoJSON items not covered by ADD_LAYER commands, add them
      while (geoIndex < collectedGeoJSON.length) {
        finalJson.commands.push({ type: "ADD_LAYER", payload: collectedGeoJSON[geoIndex++] });
      }
    }

    return NextResponse.json({
      content: finalJson,
      toolCalls: toolCallsMade,
      usage: result.response.usageMetadata,
    });
  } catch (error: any) {
    console.error("[Chat API Error]", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
