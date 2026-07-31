import { NextRequest } from "next/server";
import {
  Runner,
  InMemorySessionService,
  InMemoryArtifactService,
  InMemoryMemoryService,
  stringifyContent,
} from "@google/adk";
import { createUserContent } from "@google/genai";
import { createADKAgent } from "@/agents/adkAgent";
import type { MapCommand } from "@/stores/useMapStore";
import { normalizeToGeoJSON, fetchAndNormalizeSpatialUrl } from "@/utils/spatialNormalizer";
import { callMCPProcess } from "@/app/api/mcp/handlers/mapboxHandler";

const resolveMcpResource = async (uri: string) => {
  try {
    console.log("🔍 [ADK Route] Resolving MCP resource URI:", uri);
    const mcpResult: any = await callMCPProcess("resources/read", { uri });
    console.log("🔍 [ADK Route] MCP readResource Result:", JSON.stringify(mcpResult, null, 2));
    if (mcpResult && Array.isArray(mcpResult.contents) && mcpResult.contents.length > 0) {
      const item = mcpResult.contents[0];
      let rawContent = item.text;
      if (!rawContent && item.blob) {
        rawContent = Buffer.from(item.blob, "base64").toString("utf-8");
      }
      console.log(`✅ [ADK Route] Resource content retrieved (length: ${rawContent?.length || 0})`);
      return rawContent;
    } else {
      console.warn("⚠️ [ADK Route] MCP result has empty contents:", mcpResult);
    }
  } catch (e) {
    console.error("❌ [ADK Route] Failed to resolve MCP resource:", uri, e);
  }
  return null;
};

// Server-wide singletons for ADK state persistence across requests & HMR reloads
const globalForADK = globalThis as unknown as {
  adkSessionService?: InMemorySessionService;
  adkArtifactService?: InMemoryArtifactService;
  adkMemoryService?: InMemoryMemoryService;
};

const globalSessionService =
  globalForADK.adkSessionService ?? new InMemorySessionService();
const globalArtifactService =
  globalForADK.adkArtifactService ?? new InMemoryArtifactService();
const globalMemoryService =
  globalForADK.adkMemoryService ?? new InMemoryMemoryService();

if (process.env.NODE_ENV !== "production") {
  globalForADK.adkSessionService = globalSessionService;
  globalForADK.adkArtifactService = globalArtifactService;
  globalForADK.adkMemoryService = globalMemoryService;
}

// Same map as in the existing chat route
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

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  let bodyData;
  try {
    bodyData = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { messages, apiKey, sessionId: requestedSessionId } = bodyData;
  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: "Missing messages" }), { status: 400 });
  }

  const sessionId = requestedSessionId || "default_adk_session";

  // Get the latest user message
  const lastMessage = messages[messages.length - 1].content;
  const userContent = createUserContent(lastMessage);

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: any) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      let mcpToolsetRef: any = null;

      try {
        sendEvent({ type: "status", message: "Initializing ADK Agent..." });

        const { rootAgent, mapboxMcpToolset } = createADKAgent(apiKey);
        mcpToolsetRef = mapboxMcpToolset;

        const runner = new Runner({
          appName: "MapsenseADK",
          agent: rootAgent,
          sessionService: globalSessionService,
          artifactService: globalArtifactService,
          memoryService: globalMemoryService,
        });

        let session = await runner.sessionService.getSession({
          appName: runner.appName,
          userId: "adk_test_user",
          sessionId: sessionId,
        });

        if (!session) {
          session = await runner.sessionService.createSession({
            appName: runner.appName,
            userId: "adk_test_user",
            sessionId: sessionId,
          });
        }

        const clientToolCommands: MapCommand[] = [];
        const toolCallsMade: any[] = [];
        let finalResponseText = "";
        let finalUsage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
        
        sendEvent({ type: "status", message: "Agent is thinking..." });

        for await (const event of runner.runAsync({
          userId: session.userId,
          sessionId: session.id,
          newMessage: userContent,
        })) {
          const agentName = event.author;

          // Process parts of the event
          if (event.content?.parts) {
            for (const part of event.content.parts) {
              if (part.functionCall) {
                const call = part.functionCall;
                sendEvent({ type: "status", message: `Executing tool: ${call.name}` });
                
                if (agentName && agentName !== "user") {
                  sendEvent({
                    type: "agent_event",
                    event: {
                      agentName,
                      type: "tool_call",
                      description: `🛠️ Called tool \`${call.name}\``,
                      toolName: call.name
                    }
                  });
                }
                
                toolCallsMade.push({
                  toolName: call.name,
                  arguments: call.args,
                  result: null
                });

                // Map to frontend map command
                const commandType = call.name ? CLIENT_TOOL_COMMAND_MAP[call.name] : undefined;
                if (commandType) {
                  if (call.name === "map_load_url" && typeof call.args?.url === "string") {
                    try {
                      sendEvent({ type: "status", message: `Fetching external spatial data...` });
                      const finalGeojson = await fetchAndNormalizeSpatialUrl(
                        call.args.url,
                        (call.args.label as string) || "Route Layer",
                        { resolveMcpResource }
                      );

                      if (finalGeojson) {
                        clientToolCommands.push({
                          type: "ADD_GEOJSON",
                          payload: { geojson: finalGeojson, label: (call.args.label as string) || "External Data" },
                        });
                      }
                    } catch (e: any) {
                      console.error("Failed to fetch URL in backend route:", e);
                    }
                  } else if (call.name === "map_add_geojson" && call.args?.geojson) {
                    const finalGeojson = normalizeToGeoJSON(call.args.geojson, (call.args.label as string) || "Custom Layer");
                    if (finalGeojson) {
                      clientToolCommands.push({
                        type: "ADD_GEOJSON",
                        payload: { geojson: finalGeojson, label: (call.args.label as string) || "Custom Layer" },
                      });
                    }
                  } else {
                    clientToolCommands.push({
                      type: commandType,
                      payload: call.args || {},
                    });
                  }
                }
              }

              if (part.functionResponse) {
                const res = part.functionResponse;
                const match = toolCallsMade.find(t => t.toolName === res.name && t.result === null);
                if (match) {
                  match.result = res.response;
                }

                // Extract spatial data from MCP tool responses
                // MCP tool results come as: { content: [...], structuredContent: {...}, isError: false }
                if (res.response) {
                  console.log("📦 [ADK Route] functionResponse for tool:", res.name, "| Keys:", Object.keys(res.response));

                  let norm: any = null;

                  // Case 0: structuredContent (MCP structured output — often contains the actual data)
                  if (!norm && (res.response as any).structuredContent) {
                    const sc = (res.response as any).structuredContent;
                    console.log("📦 [ADK Route] structuredContent keys:", Object.keys(sc));
                    const candidate = normalizeToGeoJSON(sc, res.name || "Mapbox Data");
                    if (candidate && candidate.features && candidate.features.length > 0) {
                      console.log("✅ [ADK Route] Extracted GeoJSON from structuredContent. Features:", candidate.features.length);
                      norm = candidate;
                    }
                  }

                  // Case 1: MCP content blocks array (standard MCP tool result format)
                  if (!norm && Array.isArray((res.response as any).content)) {
                    const contentBlocks = (res.response as any).content;
                    console.log("📦 [ADK Route] MCP content blocks count:", contentBlocks.length);
                    
                    for (const block of contentBlocks) {
                      if (norm) break; // already found spatial data
                      
                      // Text block — may contain JSON / GeoJSON inline
                      if (block.type === "text" && typeof block.text === "string") {
                        const trimmed = block.text.trim();
                        console.log("📄 [ADK Route] Text block preview:", trimmed.substring(0, 200));
                        
                        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                          const candidate = normalizeToGeoJSON(trimmed, res.name || "Mapbox Data");
                          if (candidate && candidate.features && candidate.features.length > 0) {
                            console.log("✅ [ADK Route] Extracted GeoJSON from text block. Features:", candidate.features.length);
                            norm = candidate;
                          }
                        }
                        // Also check if text contains a mapbox:// URI we can resolve
                        const mapboxUriMatch = trimmed.match(/mapbox:\/\/temp\/[^\s"']+/);
                        if (!norm && mapboxUriMatch) {
                          console.log("🔗 [ADK Route] Found mapbox URI in text:", mapboxUriMatch[0]);
                          norm = await fetchAndNormalizeSpatialUrl(mapboxUriMatch[0], "Mapbox Layer", { resolveMcpResource });
                        }
                        // Check for https:// Mapbox API URLs
                        const httpUrlMatch = trimmed.match(/https:\/\/api\.mapbox\.com\/[^\s"']+/);
                        if (!norm && httpUrlMatch) {
                          console.log("🔗 [ADK Route] Found Mapbox API URL in text:", httpUrlMatch[0]);
                          norm = await fetchAndNormalizeSpatialUrl(httpUrlMatch[0], "Mapbox Layer", { resolveMcpResource });
                        }
                      }
                      
                      // Resource block — may contain inline data
                      if (block.type === "resource" && block.resource) {
                        const resource = block.resource;
                        console.log("📄 [ADK Route] Resource block URI:", resource.uri, "| Has text:", !!resource.text, "| Has blob:", !!resource.blob);
                        if (resource.text) {
                          const candidate = normalizeToGeoJSON(resource.text, res.name || "Mapbox Data");
                          if (candidate && candidate.features && candidate.features.length > 0) {
                            console.log("✅ [ADK Route] Extracted GeoJSON from resource block. Features:", candidate.features.length);
                            norm = candidate;
                          }
                        } else if (resource.blob) {
                          try {
                            const decoded = Buffer.from(resource.blob, "base64").toString("utf-8");
                            const candidate = normalizeToGeoJSON(decoded, res.name || "Mapbox Data");
                            if (candidate && candidate.features && candidate.features.length > 0) {
                              console.log("✅ [ADK Route] Extracted GeoJSON from resource blob. Features:", candidate.features.length);
                              norm = candidate;
                            }
                          } catch (e) {
                            console.warn("⚠️ [ADK Route] Failed to decode resource blob");
                          }
                        } else if (resource.uri) {
                          console.log("🔗 [ADK Route] Resource URI:", resource.uri);
                          norm = await fetchAndNormalizeSpatialUrl(resource.uri, "Mapbox Layer", { resolveMcpResource });
                        }
                      }
                    }
                  }

                  // Case 2: Direct object (no content blocks wrapper)
                  if (!norm) {
                    norm = normalizeToGeoJSON(res.response, "Mapbox Data");
                  }

                  // Case 3: URL string field
                  if (!norm && typeof res.response === "object" && typeof (res.response as any).url === "string") {
                    norm = await fetchAndNormalizeSpatialUrl((res.response as any).url, "Mapbox Layer", { resolveMcpResource });
                  }

                  if (norm && norm.features && norm.features.length > 0) {
                    console.log("🎯 [ADK Route] Adding GeoJSON to clientToolCommands. Features:", norm.features.length);
                    clientToolCommands.push({
                      type: "ADD_GEOJSON",
                      payload: { geojson: norm, label: "Mapbox Layer" },
                    });
                  }
                }
              }
            }
          }

          // Accumulate or capture the final text
          if (event.content && event.content.role === 'model') {
            let chunkText = "";
            for (const part of event.content.parts || []) {
               if (part.text) chunkText += part.text;
            }
            if (chunkText) {
               console.log(`💬 [ADK Route] Model text from '${agentName}': ${chunkText.substring(0, 100)}...`);
               const prefix = finalResponseText.length > 0 && !finalResponseText.endsWith("\n") ? "\n\n" : "";
               finalResponseText += prefix + chunkText;
               sendEvent({ type: "stream", message: prefix + chunkText });
            }
          }

          // Capture and stream agent-level errors (e.g., 429 Quota Exceeded)
          const evt = event as any;
          if (evt.errorMessage) {
            console.error(`⚠️ [ADK Route] Agent Error from '${agentName}': ${evt.errorMessage}`);
            const errorCode = evt.errorCode ? ` (Code: ${evt.errorCode})` : '';
            const errorBlock = `\n\n> ⚠️ **Error from ${agentName || 'Agent'}${errorCode}:**\n> ${evt.errorMessage}\n\n`;
            
            finalResponseText += errorBlock;
            sendEvent({ type: "stream", message: errorBlock });
          }

          if (event.usageMetadata && agentName && agentName !== "user") {
            const tokens = event.usageMetadata.totalTokenCount;
            sendEvent({
              type: "agent_event",
              event: {
                agentName,
                type: "completion",
                description: `✅ Completed task (⚡ ${tokens} tokens)`,
                tokens
              }
            });
          }

          if (event.usageMetadata) {
            finalUsage.promptTokenCount += event.usageMetadata.promptTokenCount || 0;
            finalUsage.candidatesTokenCount += event.usageMetadata.candidatesTokenCount || 0;
            finalUsage.totalTokenCount += event.usageMetadata.totalTokenCount || 0;
          }
        }

        // Fallback: If no map command was emitted but user prompt contains a URL, try fetching & normalizing it directly
        const promptUrlMatch = lastMessage.match(/https?:\/\/[^\s"']+/i);
        if (
          promptUrlMatch &&
          !clientToolCommands.some((c) => c.type === "ADD_GEOJSON" || c.type === "LOAD_URL")
        ) {
          try {
            sendEvent({ type: "status", message: "Fetching URL provided in message..." });
            const norm = await fetchAndNormalizeSpatialUrl(promptUrlMatch[0], "User URL Layer", { resolveMcpResource });
            if (norm && norm.features && norm.features.length > 0) {
              clientToolCommands.push({
                type: "ADD_GEOJSON",
                payload: { geojson: norm, label: "User URL Layer" },
              });
            }
          } catch (e) {
            console.error("Failed to auto-fetch prompt URL:", e);
          }
        }

        sendEvent({ type: "status", message: "Finalizing response..." });

        console.log("📝 [ADK Route] finalResponseText length:", finalResponseText.length, "| Preview:", finalResponseText.substring(0, 150));
        console.log("🚀 [ADK Route] clientToolCommands count:", clientToolCommands.length);

        sendEvent({
          type: "result",
          data: {
            content: { text: finalResponseText, commands: [] },
            toolCalls: toolCallsMade,
            clientToolCommands: clientToolCommands,
            usage: finalUsage,
          }
        });

      } catch (err: any) {
        console.error("[ADK Chat Error]", err);
        sendEvent({ type: "error", message: err.message || "Internal Server Error" });
      } finally {
        if (mcpToolsetRef) {
          try {
             await mcpToolsetRef.close();
          } catch(e) {
             console.error("Failed to close MCP Toolset", e);
          }
        }
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
