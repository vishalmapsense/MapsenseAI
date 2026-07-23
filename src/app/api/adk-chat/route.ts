import { NextRequest } from "next/server";
import { InMemoryRunner, stringifyContent } from "@google/adk";
import { createUserContent } from "@google/genai";
import { createADKAgent } from "@/agents/adkAgent";
import type { MapCommand } from "@/stores/useMapStore";

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

  const { messages, apiKey } = bodyData;
  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: "Missing messages" }), { status: 400 });
  }



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

        const runner = new InMemoryRunner({ agent: rootAgent });

        const session = await runner.sessionService.createSession({
          appName: runner.appName,
          userId: "adk_test_user",
        });

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
                  if (call.name === "map_load_url" && call.args?.url) {
                    try {
                      let targetUrl = call.args.url;
                      
                      // Force Mapbox Directions API to return GeoJSON instead of encoded polylines
                      try {
                        const urlObj = new URL(targetUrl);
                        if (urlObj.hostname.includes('mapbox.com') && urlObj.pathname.includes('/directions/')) {
                          urlObj.searchParams.set('geometries', 'geojson');
                          targetUrl = urlObj.toString();
                        }
                      } catch (e) {
                         // invalid url, ignore
                      }

                      sendEvent({ type: "status", message: `Fetching external spatial data...` });
                      const fetchResponse = await fetch(targetUrl);
                      if (!fetchResponse.ok) throw new Error(`HTTP ${fetchResponse.status}`);
                      const rawData = await fetchResponse.json();
                      
                      let finalGeojson = rawData;

                      // Normalize Mapbox Directions API response to GeoJSON
                      if (!rawData.type && rawData.routes && rawData.routes.length > 0) {
                        const route = rawData.routes[0];
                        if (route.geometry && typeof route.geometry === 'object') {
                          finalGeojson = {
                            type: "Feature",
                            geometry: route.geometry,
                            properties: {
                              name: call.args.label || "Route Layer",
                              distance: route.distance,
                              duration: route.duration
                            }
                          };
                        } else if (typeof route.geometry === 'string') {
                           // If it's still a string (polyline), we can't parse it easily here without a library
                           console.error("Mapbox returned an encoded polyline instead of GeoJSON object.");
                        }
                      }
                      
                      clientToolCommands.push({
                        type: "ADD_GEOJSON",
                        payload: { geojson: finalGeojson, label: call.args.label || "External Data" },
                      });
                    } catch (e: any) {
                      console.error("Failed to fetch URL in backend route:", e);
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
               const prefix = finalResponseText.length > 0 && !finalResponseText.endsWith("\n") ? "\n\n" : "";
               finalResponseText += prefix + chunkText;
               sendEvent({ type: "stream", message: prefix + chunkText });
            }
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

        sendEvent({ type: "status", message: "Finalizing response..." });

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
