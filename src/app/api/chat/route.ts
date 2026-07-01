import { NextRequest } from "next/server";
import { GoogleGenerativeAI, SchemaType, Schema, FunctionCallingMode } from "@google/generative-ai";
import { callMCPProcess } from "../mcp/handlers/mapboxHandler";
import { MCPTool, MCPToolCall } from "@/types/mcp.types";
import { convertMCPToolsToGeminiTools } from "@/lib/mcpToGemini";
import { INTENT_CLASSIFICATION_PROMPT, MAIN_ORCHESTRATOR_PROMPT } from "@/config/prompts";
import { ALL_CLIENT_TOOLS, isClientTool, buildClientToolResponse } from "@/config/clientTools";
import type { MapCommand } from "@/stores/useMapStore";

// ─── Helper: Any GeoJSON-like data ko FeatureCollection me normalize karo ────
const GEOMETRY_TYPES = ["Point","MultiPoint","LineString","MultiLineString","Polygon","MultiPolygon","GeometryCollection"];

function normalizeToFeatureCollection(data: any): any | null {
  if (!data || typeof data !== "object") return null;

  // Already a FeatureCollection
  if (data.type === "FeatureCollection") {
    return {
      type: "FeatureCollection",
      features: Array.isArray(data.features)
        ? data.features.filter((f: any) => f && f.type === "Feature" && f.geometry)
        : [],
    };
  }

  // A single Feature
  if (data.type === "Feature" && data.geometry) {
    return { type: "FeatureCollection", features: [data] };
  }

  // A raw geometry object (Point, LineString, Polygon, etc.)
  if (GEOMETRY_TYPES.includes(data.type)) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: data, properties: {} }],
    };
  }

  // Mapbox Directions API: { routes: [{ geometry, distance, duration }] }
  if (Array.isArray(data.routes) && data.routes.length > 0) {
    const features = data.routes
      .filter((r: any) => r.geometry)
      .map((r: any) => ({
        type: "Feature",
        geometry: r.geometry,
        properties: { distance: r.distance, duration: r.duration },
      }));
    if (features.length > 0) return { type: "FeatureCollection", features };
  }

  // Mapbox Isochrone API: { features: [...] } at top level
  if (Array.isArray(data.features)) {
    const features = data.features.filter((f: any) => f && f.geometry);
    return { type: "FeatureCollection", features };
  }

  // Mapbox Geocoding: { features: [{center, place_name, geometry}] }
  if (data.type === "geocode" || (data.attribution && Array.isArray(data.features))) {
    const features = (data.features || []).filter((f: any) => f && f.geometry);
    return { type: "FeatureCollection", features };
  }

  return null;
}

// Legacy alias kept for compatibility
const extractGeoJSON = normalizeToFeatureCollection;

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

// ─── Map: client tool name → MapCommand type ─────────────────────────────────
const CLIENT_TOOL_COMMAND_MAP: Record<string, MapCommand["type"]> = {
  map_zoom_in: "ZOOM_IN",
  map_zoom_out: "ZOOM_OUT",
  map_set_zoom: "SET_ZOOM",
  map_rotate: "ROTATE",
  map_reset_rotation: "RESET_ROTATION",
  map_fly_to: "FLY_TO",
  map_fit_bounds: "FIT_BOUNDS",
  map_set_base: "SET_BASE_MAP",
  map_clear_layers: "CLEAR_MAP",
  map_toggle_layer: "TOGGLE_LAYER",
  map_add_marker: "ADD_MARKER",
  map_remove_marker: "REMOVE_MARKER",
  map_move_marker: "MOVE_MARKER",
  map_draw_point: "DRAW_POINT",
  map_draw_line: "DRAW_LINE",
  map_draw_polygon: "DRAW_POLYGON",
  map_draw_circle: "DRAW_CIRCLE",
  map_draw_rectangle: "DRAW_RECTANGLE",
  map_edit_geometry: "EDIT_GEOMETRY",
  map_delete_geometry: "DELETE_GEOMETRY",
  map_simplify_geometry: "SIMPLIFY_GEOMETRY",
  map_buffer_geometry: "BUFFER_GEOMETRY",
  map_add_geojson: "ADD_GEOJSON",
  map_load_url: "LOAD_URL",
  map_split_polygon: "SPLIT_POLYGON",
  map_merge_polygons: "MERGE_POLYGONS",
};

// ─── POST Handler (Streaming) ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  let bodyData;
  try {
    bodyData = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { messages, modelId, provider, apiKey, userLocation, mapViewState, baseMap } = bodyData;

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
        
        // --- Inject System Context ---
        let systemContext = "[System Context:";
        if (userLocation && userLocation.lat && userLocation.lng) {
          systemContext += ` The user's current GPS location is Latitude: ${userLocation.lat}, Longitude: ${userLocation.lng}.`;
        }
        if (mapViewState) {
          systemContext += ` The current map view is centered at [lng: ${mapViewState.center[0].toFixed(4)}, lat: ${mapViewState.center[1].toFixed(4)}] with zoom level ${mapViewState.zoom.toFixed(1)} and rotation ${mapViewState.rotation}°.`;
        }
        if (baseMap) {
          systemContext += ` The current active base map style is '${baseMap}'.`;
        }
        systemContext += "]";
        
        if (systemContext.length > 17) {
          lastMessage = `${systemContext}\n\n${lastMessage}`;
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
              description: "One of: conversation, greeting, help, knowledge, geocode, nearby_search, routing, buffer, isochrone, spatial_analysis, map_visualization, layer_management, map_interaction, unknown",
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
          sendEvent({ type: "status", message: "Loading capabilities..." });
          const toolsResult = await callMCPProcess("tools/list") as { tools: MCPTool[] };
          const mcpGeminiTools = convertMCPToolsToGeminiTools(toolsResult.tools);
          // Merge MCP tools + Client tools into a single declarations array
          geminiTools = [...mcpGeminiTools, ...ALL_CLIENT_TOOLS];
        } else {
          sendEvent({ type: "status", message: "Generating conversational response..." });
        }

        const responseSchema: Schema = {
          type: SchemaType.OBJECT,
          properties: {
            text: {
              type: SchemaType.STRING,
              description: "Human-readable AI response in Markdown. All map operations are performed exclusively through tool calls — never through JSON commands.",
            },
          },
          required: ["text"],
        };

        // When tools are available, use AUTO mode so the model decides when to call tools.
        // When no tools, use structured JSON output.
        const mainModel = genAI.getGenerativeModel({
          model: modelId,
          tools: requiresTools && geminiTools.length > 0 ? [{ functionDeclarations: geminiTools }] : undefined,
          toolConfig: requiresTools && geminiTools.length > 0
            ? { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }
            : undefined,
          generationConfig: requiresTools && geminiTools.length > 0
            ? {} // No JSON schema when function calling is active (causes 400)
            : {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
              },
          systemInstruction: MAIN_ORCHESTRATOR_PROMPT,
        });

        const mainChat = mainModel.startChat({ history });
        const toolCallsMade: MCPToolCall[] = [];
        const clientToolCommands: MapCommand[] = []; // Collect client tool actions
        
        let result = await mainChat.sendMessage([{ text: lastMessage }]);
        let functionCalls = result.response.functionCalls();

        if (result.response.usageMetadata) {
          totalUsage.promptTokenCount += result.response.usageMetadata.promptTokenCount || 0;
          totalUsage.candidatesTokenCount += result.response.usageMetadata.candidatesTokenCount || 0;
          totalUsage.totalTokenCount += result.response.usageMetadata.totalTokenCount || 0;
        }

        // ====================================================================
        // STEP 3: Handle Tool Execution Loop (Hybrid: Client + MCP)
        // ====================================================================
        while (functionCalls && functionCalls.length > 0) {
          const functionResponses = [];

          for (const call of functionCalls) {
            sendEvent({ type: "status", message: `Executing: ${call.name.replace(/^map_/, '').replace(/_/g, ' ')}...` });
            console.log(`[Gemini] Calling tool: ${call.name}`);
            
            // ── Client Tool Path ──────────────────────────────────
            if (isClientTool(call.name)) {
              // Special handling: map_load_url fetches GeoJSON from a URL server-side
              if (call.name === "map_load_url") {
                const url = (call.args as any)?.url;
                const label = (call.args as any)?.label || "Remote Layer";
                let fetchSuccess = false;
                if (url) {
                  try {
                    sendEvent({ type: "status", message: `Fetching data from URL...` });
                    const fetchRes = await fetch(url);
                    if (fetchRes.ok) {
                      const rawData = await fetchRes.json();
                      const geoJSON = extractGeoJSON(rawData);
                      if (geoJSON) {
                        // Inject label into features
                        if (geoJSON.type === "FeatureCollection" && Array.isArray(geoJSON.features)) {
                          geoJSON.features.forEach((f: any) => { if (!f.properties) f.properties = {}; f.properties._label = label; });
                        } else if (geoJSON.type === "Feature") {
                          if (!geoJSON.properties) geoJSON.properties = {};
                          geoJSON.properties._label = label;
                        }
                        clientToolCommands.push({ type: "ADD_GEOJSON", payload: { geojson: geoJSON, label } });
                        fetchSuccess = true;
                        console.log(`[map_load_url] Fetched and queued GeoJSON from ${url}`);
                      }
                    }
                  } catch (fetchErr: any) {
                    console.error(`[map_load_url] Failed to fetch ${url}:`, fetchErr.message);
                  }
                }
                functionResponses.push({
                  functionResponse: {
                    name: call.name,
                    response: fetchSuccess
                      ? { success: true, message: `GeoJSON data fetched from ${url} and added to the map.` }
                      : { success: false, message: `Failed to fetch or parse GeoJSON from the provided URL.` },
                  },
                });
                continue;
              }

              const commandType = CLIENT_TOOL_COMMAND_MAP[call.name];
              if (commandType) {
                clientToolCommands.push({ type: commandType, payload: call.args || {} });
                console.log(`[Client Tool] ${call.name} → ${commandType}`, call.args);
              }
              
              // Return a synthetic "success" response to the LLM
              functionResponses.push({
                functionResponse: {
                  name: call.name,
                  response: buildClientToolResponse(call.name, call.args as Record<string, unknown> || {}),
                },
              });
              continue;
            }

            // ── MCP Tool Path ─────────────────────────────────────
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
          // Model sometimes outputs multiple JSON objects — extract the first one
          const cleanedText = rawContent
            .replace(/^```(json)?\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
          
          const firstBrace = cleanedText.indexOf('{');
          const lastBrace = cleanedText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            try {
              finalJson = JSON.parse(cleanedText.slice(firstBrace, lastBrace + 1));
            } catch {
              finalJson = JSON.parse(cleanedText);
            }
          } else {
            finalJson = JSON.parse(cleanedText);
          }
          
          if (!finalJson.text && !finalJson.commands) {
            finalJson = { text: rawContent, commands: [] };
          }
        } catch (e) {
          const jsonMatch = rawContent.match(/\{[\s\S]*?"text"\s*:\s*"([^"]+)"/);
          const extractedText = jsonMatch ? jsonMatch[1] : rawContent;
          finalJson = { text: extractedText, commands: [] };
        }

        // ── Resolve GeoJSON from MCP tool results and push as ADD_GEOJSON client commands ──
        // NOTE: The LLM no longer generates commands or map_actions. All map operations
        // go through tool calls. Here we auto-convert any raw MCP results (that the LLM
        // did not explicitly render via map_add_geojson) into ADD_GEOJSON commands as a
        // safety net, so data is never silently dropped.
        if (toolCallsMade.length > 0) {
          const llmExplicitlyAddedGeoJSON = clientToolCommands.some((c) => c.type === "ADD_GEOJSON");

          for (const tc of toolCallsMade) {
            // Check if the LLM already explicitly rendered this data
            let alreadyRendered = false;
            if (tc.resourceUri) {
              alreadyRendered = clientToolCommands.some(
                (c) => c.type === "LOAD_URL" && c.payload?.url === tc.resourceUri
              );
            } else {
              // For inline results, if LLM used ADD_GEOJSON, we assume it handled the data
              alreadyRendered = llmExplicitlyAddedGeoJSON;
            }

            if (alreadyRendered) continue;

            let geoJSON: any = null;
            if (tc.resourceUri) {
              try {
                const resolved: any = await callMCPProcess("resources/read", { uri: tc.resourceUri });
                if (resolved && resolved.contents && resolved.contents.length > 0) {
                  const textData = resolved.contents[0].text;
                  const parsed = JSON.parse(textData);
                  console.log(`[Post-Processing] Resolved URI Data for ${tc.resourceUri}:`, JSON.stringify(parsed).substring(0, 500) + "...");
                  geoJSON = extractGeoJSON(parsed);
                  console.log(`[Post-Processing] Extracted GeoJSON:`, geoJSON ? "Success" : "Failed");
                }
              } catch (err: any) {
                console.error(`[Post-Processing] Failed to read resource ${tc.resourceUri}:`, err.message);
              }
            } else {
              geoJSON = extractGeoJSONFromToolResult(tc.result);
            }

            if (geoJSON) {
              clientToolCommands.push({
                type: "ADD_GEOJSON",
                payload: { geojson: geoJSON, label: tc.toolName },
              });
              console.log(`[Post-Processing] Safety-net: Converted MCP result from '${tc.toolName}' to ADD_GEOJSON.`);
            }
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
            clientToolCommands, // Client tool commands for frontend execution
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
