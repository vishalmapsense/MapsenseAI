import { NextRequest } from "next/server";
import { GoogleGenerativeAI, SchemaType, Schema } from "@google/generative-ai";
import { callMCPProcess } from "../mcp/handlers/mapboxHandler";
import { MCPTool, MCPToolCall } from "@/types/mcp.types";
import { convertMCPToolsToGeminiTools } from "@/lib/mcpToGemini";
import { INTENT_CLASSIFICATION_PROMPT, MAIN_ORCHESTRATOR_PROMPT } from "@/config/prompts";

// ─── Helper: GeoJSON extract karo tool result se ─────────────────────────────
function extractGeoJSON(data: any): any | null {
  if (!data) return null;
  if (["FeatureCollection", "Feature"].includes(data.type)) {
    return data;
  }
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
  const sc = extractGeoJSON(r.structuredContent);
  if (sc) return sc;
  if (r.content && Array.isArray(r.content)) {
    for (const block of r.content as any[]) {
      if (block.type === "text" && block.text) {
        try {
          const parsed = JSON.parse(block.text);
          const pd = extractGeoJSON(parsed);
          if (pd) return pd;
        } catch {}
      }
    }
  }
  return null;
}

function extractResourceUriFromText(text: string): string | null {
  if (!text) return null;
  const match = text.match(/(mapbox:\/\/temp\/[a-zA-Z0-9-]+)/);
  return match ? match[1] : null;
}

// ─── POST Handler (Streaming) ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  let bodyData;
  try {
    bodyData = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { messages, modelId, provider, apiKey, userLocation } = bodyData;

  if (!messages || !modelId || !provider || !apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing required fields (messages, modelId, provider, apiKey)" }),
      { status: 400 }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: any) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const history = messages.slice(0, -1).map((m: any) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content }],
        }));
        
        let lastMessage = messages[messages.length - 1].content;
        if (userLocation && userLocation.lat && userLocation.lng) {
          lastMessage = `[System Context: The user's current GPS location is Latitude: ${userLocation.lat}, Longitude: ${userLocation.lng}.]\n\n${lastMessage}`;
        }

        // ====================================================================
        // STEP 1: Intent Classification (Fast, lightweight LLM call, no tools)
        // ====================================================================
        sendEvent({ type: "status", message: "Analyzing query intent..." });

        const intentSchema: Schema = {
          type: SchemaType.OBJECT,
          properties: {
            requiresTools: {
              type: SchemaType.BOOLEAN,
              description: "True if the query requires geospatial tools. False for greetings, general chat, or knowledge questions.",
            },
            intent: {
              type: SchemaType.STRING,
              description: "One of: conversation, greeting, help, knowledge, geocode, nearby_search, routing, buffer, isochrone, spatial_analysis, map_visualization, layer_management, unknown",
            },
            reason: {
              type: SchemaType.STRING,
              description: "Brief reason for the classification.",
            }
          },
          required: ["requiresTools", "intent", "reason"],
        };

        const intentModel = genAI.getGenerativeModel({
          model: modelId,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: intentSchema,
            temperature: 0.1,
          },
          systemInstruction: INTENT_CLASSIFICATION_PROMPT,
        });

        const intentChat = intentModel.startChat({ history });
        const intentResult = await intentChat.sendMessage([{ text: lastMessage }]);
        
        const intentData = JSON.parse(intentResult.response.text());
        const requiresTools = intentData.requiresTools;
        
        console.log(`[Intent] ${intentData.intent} | Tools: ${requiresTools} | ${intentData.reason}`);
        
        const totalUsage = {
          promptTokenCount: intentResult.response.usageMetadata?.promptTokenCount || 0,
          candidatesTokenCount: intentResult.response.usageMetadata?.candidatesTokenCount || 0,
          totalTokenCount: intentResult.response.usageMetadata?.totalTokenCount || 0,
        };

        // ====================================================================
        // STEP 2: Response Generation (with or without tools)
        // ====================================================================
        
        let geminiTools: any[] = [];
        if (requiresTools) {
          sendEvent({ type: "status", message: "Loading Mapbox capabilities..." });
          const toolsResult = await callMCPProcess("tools/list") as { tools: MCPTool[] };
          geminiTools = convertMCPToolsToGeminiTools(toolsResult.tools);
        } else {
          sendEvent({ type: "status", message: "Generating conversational response..." });
        }

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

        const mainModel = genAI.getGenerativeModel({
          model: modelId,
          tools: requiresTools && geminiTools.length > 0 ? [{ functionDeclarations: geminiTools }] : undefined,
          generationConfig: requiresTools && geminiTools.length > 0 
            ? {} // Do not use responseMimeType with function calling to prevent 400 Bad Request
            : {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
              },
          systemInstruction: MAIN_ORCHESTRATOR_PROMPT,
        });

        const mainChat = mainModel.startChat({ history });
        const toolCallsMade: MCPToolCall[] = [];
        
        let result = await mainChat.sendMessage([{ text: lastMessage }]);
        let functionCalls = result.response.functionCalls();

        if (result.response.usageMetadata) {
          totalUsage.promptTokenCount += result.response.usageMetadata.promptTokenCount || 0;
          totalUsage.candidatesTokenCount += result.response.usageMetadata.candidatesTokenCount || 0;
          totalUsage.totalTokenCount += result.response.usageMetadata.totalTokenCount || 0;
        }

        // ====================================================================
        // STEP 3: Handle Tool Execution Loop
        // ====================================================================
        while (functionCalls && functionCalls.length > 0) {
          const functionResponses = [];

          for (const call of functionCalls) {
            sendEvent({ type: "status", message: `Executing tool: ${call.name.replace(/_/g, ' ')}...` });
            console.log(`[Gemini] Calling tool: ${call.name}`);
            
            try {
              const rawToolResult = await callMCPProcess("tools/call", {
                name: call.name,
                arguments: call.args,
              });

              let resourceUri = undefined;
              if (rawToolResult && (rawToolResult as any).content) {
                for (const block of (rawToolResult as any).content) {
                  if (block.type === "text") {
                    const match = extractResourceUriFromText(block.text);
                    if (match) resourceUri = match;
                  }
                }
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
                  response: rawToolResult as object,
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

          sendEvent({ type: "status", message: "Synthesizing spatial data..." });
          result = await mainChat.sendMessage(functionResponses);
          functionCalls = result.response.functionCalls();

          if (result.response.usageMetadata) {
            totalUsage.promptTokenCount += result.response.usageMetadata.promptTokenCount || 0;
            totalUsage.candidatesTokenCount += result.response.usageMetadata.candidatesTokenCount || 0;
            totalUsage.totalTokenCount += result.response.usageMetadata.totalTokenCount || 0;
          }
        }

        // ====================================================================
        // STEP 4: Parsing & Post-Processing
        // ====================================================================
        sendEvent({ type: "status", message: "Finalizing map rendering..." });

        const rawContent = result.response.text();
        let finalJson;
        try {
          const cleanedText = rawContent.replace(/^```(json)?\s*/i, '').replace(/```\s*$/i, '').trim();
          finalJson = JSON.parse(cleanedText);
        } catch (e) {
          finalJson = { text: rawContent, commands: [] };
        }

        if (finalJson.commands && Array.isArray(finalJson.commands) && toolCallsMade.length > 0) {
          const collectedGeoJSON: unknown[] = [];

          for (const tc of toolCallsMade) {
            if (tc.resourceUri) {
              try {
                const resolved: any = await callMCPProcess("resources/read", { uri: tc.resourceUri });
                if (resolved && resolved.contents && resolved.contents.length > 0) {
                  const textData = resolved.contents[0].text;
                  const parsed = JSON.parse(textData);
                  const geoJSON = extractGeoJSON(parsed);
                  if (geoJSON) collectedGeoJSON.push(geoJSON);
                }
              } catch (err: any) {
                console.error(`[Post-Processing] Failed to read resource ${tc.resourceUri}:`, err.message);
              }
            } else {
              const geoJSON = extractGeoJSONFromToolResult(tc.result);
              if (geoJSON) collectedGeoJSON.push(geoJSON);
            }
          }

          let geoIndex = 0;
          finalJson.commands = finalJson.commands.map((cmd: any) => {
            if (cmd.type === "ADD_LAYER" && geoIndex < collectedGeoJSON.length) {
              return { ...cmd, payload: collectedGeoJSON[geoIndex++] };
            }
            return cmd;
          });

          while (geoIndex < collectedGeoJSON.length) {
            finalJson.commands.push({ type: "ADD_LAYER", payload: collectedGeoJSON[geoIndex++] });
          }
        }

        // ====================================================================
        // STEP 5: Emit Final Result
        // ====================================================================
        sendEvent({
          type: "result",
          data: {
            content: finalJson,
            toolCalls: toolCallsMade,
            usage: totalUsage,
          },
        });

        controller.close();
      } catch (error: any) {
        console.error("[Chat API Error]", error);
        sendEvent({ type: "error", message: error.message || "Internal server error" });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
