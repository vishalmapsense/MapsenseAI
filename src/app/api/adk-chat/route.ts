import { NextRequest } from "next/server";
import {
  Runner,
  InMemorySessionService,
  getSessionServiceFromUri,
  InMemoryArtifactService,
  InMemoryMemoryService,
  BaseSessionService,
  stringifyContent,
  isCompactedEvent,
} from "@google/adk";
import { createUserContent, GoogleGenAI } from "@google/genai";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createADKAgent } from "@/agents/adkAgent";
import type { SpatialDataBuffer } from "@/agents/utils/spatialDataInterceptor";
import type { MapCommand } from "@/stores/useMapStore";
import {
  normalizeToGeoJSON,
  fetchAndNormalizeSpatialUrl,
} from "@/utils/spatialNormalizer";
import { callMCPProcess } from "@/app/api/mcp/handlers/mapboxHandler";

const resolveMcpResource = async (uri: string) => {
  try {
    console.log("🔍 [ADK Route] Resolving MCP resource URI:", uri);
    const mcpResult: any = await callMCPProcess("resources/read", { uri });
    console.log(
      "🔍 [ADK Route] MCP readResource Result:",
      JSON.stringify(mcpResult, null, 2),
    );
    if (
      mcpResult &&
      Array.isArray(mcpResult.contents) &&
      mcpResult.contents.length > 0
    ) {
      const item = mcpResult.contents[0];
      let rawContent = item.text;
      if (!rawContent && item.blob) {
        rawContent = Buffer.from(item.blob, "base64").toString("utf-8");
      }
      console.log(
        `✅ [ADK Route] Resource content retrieved (length: ${rawContent?.length || 0})`,
      );
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
  adkSessionService?: BaseSessionService;
  adkArtifactService?: InMemoryArtifactService;
  adkMemoryService?: InMemoryMemoryService;
};

const initSessionService = (): BaseSessionService => {
  const dbUri =
    process.env.ADK_SESSION_DB_URI || "sqlite://mapsense_adk.sqlite";
  try {
    console.log(`🗄️ [ADK] Initializing DatabaseSessionService (${dbUri})...`);
    return getSessionServiceFromUri(dbUri);
  } catch (err) {
    console.warn(
      "⚠️ [ADK] Could not initialize DatabaseSessionService, falling back to InMemorySessionService:",
      err,
    );
    return new InMemorySessionService();
  }
};

export const globalSessionService =
  globalForADK.adkSessionService ?? initSessionService();
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
  map_toggle_3d: "TOGGLE_3D",
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
  map_select_layer: "SELECT_LAYER",
  request_user_permission: "REQUEST_PERMISSION",
};

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  let bodyData;
  try {
    bodyData = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
    });
  }

  const { messages, apiKey, sessionId: requestedSessionId } = bodyData;
  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: "Missing messages" }), {
      status: 400,
    });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const userId = user.email || user.id;

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

        // Shared buffer: afterToolCallback in agents writes intercepted spatial data here
        const spatialBuffer: SpatialDataBuffer = [];
        const { rootAgent, mapboxMcpToolset, spatialDataBuffer } =
          await createADKAgent(apiKey, lastMessage, spatialBuffer);
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
          userId: userId,
          sessionId: sessionId,
        });

        let isNewSession = false;
        if (!session) {
          isNewSession = true;
          session = await runner.sessionService.createSession({
            appName: runner.appName,
            userId: userId,
            sessionId: sessionId,
          });
        }
        let activeTitle: string | undefined;

        if (isNewSession || (session.events && session.events.length === 0)) {
          let generatedTitle =
            lastMessage.slice(0, 30) + (lastMessage.length > 30 ? "..." : "");
          try {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
              model: "gemini-3.1-flash-lite",
              contents: `Generate a concise, professional 2 to 4 word topic heading for a chat conversation starting with this user message:\n\n"${lastMessage}"\n\nRules:\n- Keep it natural, clean, and highly relevant (2 to 4 words max).\n- Use Title Case formatting.\n- Do NOT use quotes, special symbols, or strange formatting.\n- Output ONLY the heading text.`,
            });
            if (response.text) {
              generatedTitle = response.text.trim().replace(/^["']|["']$/g, "");
            }
          } catch (e) {
            console.error("Failed to generate title with LLM", e);
          }

          activeTitle = generatedTitle;

          // Save title to session state
          await runner.sessionService.appendEvent({
            session,
            event: {
              id: crypto.randomUUID(),
              invocationId: crypto.randomUUID(),
              timestamp: Date.now(),
              source: "system",
              actions: {
                stateDelta: { title: generatedTitle },
              },
            } as any,
          });
        }

        const clientToolCommands: MapCommand[] = [];
        const toolCallsMade: any[] = [];
        const agentErrors: { agent: string; code: string; message: string }[] = [];
        let finalResponseText = "";
        let finalUsage = {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
          totalTokenCount: 0,
        };

        sendEvent({ type: "status", message: "Agent is thinking..." });

        let currentInput: any | undefined = userContent;
        let retryCount = 0;
        const maxRetries = 1;

        while (true) {
          let routingErrorDetected = false;
          let failedAgent = "";
          let failedMessage = "";

          for await (const event of runner.runAsync({
            userId: session.userId,
            sessionId: session.id,
            newMessage: currentInput,
          })) {
          // Ignore internal context compaction events generated by TokenBasedContextCompactor
          if (isCompactedEvent(event) || (event as any).isCompacted) {
            console.log(`ℹ️ [ADK Route] Skipping internal context compaction event (${event.id || "compacted"})`);
            continue;
          }

          const agentName = event.author;

          console.log(
            `\n======================================================`,
          );
          console.log(`🔄 [ADK Flow] Current Active Agent: ${agentName}`);
          console.log(`======================================================`);

          // Process parts of the event
          if (event.content?.parts) {
            for (const part of event.content.parts) {
              if (part.text) {
                console.log(
                  `💬 [ADK Flow - ${agentName}] generated text:`,
                  part.text.substring(0, 100).replace(/\n/g, " ") +
                    (part.text.length > 100 ? "..." : ""),
                );
              }

              if (part.functionCall) {
                const call = part.functionCall;
                console.log(
                  `🛠️ [ADK Flow - ${agentName}] called tool: ${call.name}`,
                );

                sendEvent({
                  type: "status",
                  message: `Executing tool: ${call.name}`,
                });

                if (agentName && agentName !== "user") {
                  sendEvent({
                    type: "agent_event",
                    event: {
                      agentName,
                      type: "tool_call",
                      description: `🛠️ Called tool \`${call.name}\``,
                      toolName: call.name,
                    },
                  });
                }

                toolCallsMade.push({
                  toolName: call.name,
                  arguments: call.args,
                  result: null,
                });

                // Map to frontend map command
                const commandType = call.name
                  ? CLIENT_TOOL_COMMAND_MAP[call.name]
                  : undefined;
                if (commandType) {
                  if (
                    call.name === "map_load_url" &&
                    typeof call.args?.url === "string"
                  ) {
                    try {
                      sendEvent({
                        type: "status",
                        message: `Fetching external spatial data...`,
                      });
                      const finalGeojson = await fetchAndNormalizeSpatialUrl(
                        call.args.url,
                        (call.args.label as string) || "Route Layer",
                        { resolveMcpResource },
                      );

                      if (finalGeojson) {
                        clientToolCommands.push({
                          type: "ADD_GEOJSON",
                          payload: {
                            geojson: finalGeojson,
                            label:
                              (call.args.label as string) || "External Data",
                          },
                        });
                      }
                    } catch (e: any) {
                      const msg = e instanceof Error ? e.message : String(e);
                      console.error("Failed to fetch URL in backend route:", e);
                      agentErrors.push({
                        agent: "route",
                        code: "FETCH_FAILED",
                        message: `Failed to load spatial data from URL: ${msg}`,
                      });
                    }
                  } else if (
                    call.name === "map_add_geojson" &&
                    call.args?.geojson
                  ) {
                    const finalGeojson = normalizeToGeoJSON(
                      call.args.geojson,
                      (call.args.label as string) || "Custom Layer",
                    );
                    if (finalGeojson) {
                      clientToolCommands.push({
                        type: "ADD_GEOJSON",
                        payload: {
                          geojson: finalGeojson,
                          label: (call.args.label as string) || "Custom Layer",
                        },
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
                const match = toolCallsMade.find(
                  (t) => t.toolName === res.name && t.result === null,
                );
                if (match) {
                  match.result = res.response;
                }

                // ─── Spatial Data: Check if afterToolCallback already intercepted ───
                // If _spatialDataExtracted flag is present, the data was already captured
                // by the afterToolCallback and stored in spatialBuffer. Skip heavy extraction.
                if (
                  res.response &&
                  (res.response as any)._spatialDataExtracted
                ) {
                  console.log(
                    `⚡ [ADK Route] Spatial data already intercepted for ${res.name} — skipping route-level extraction.`,
                  );
                } else if (res.response) {
                  // Fallback: Legacy extraction for tools without afterToolCallback
                  // (e.g., if a new tool is added but not intercepted)
                  console.log(
                    `📦 [ADK Route] functionResponse for tool: ${res.name} (no interception — fallback extraction)`,
                  );

                  let norm: any = null;

                  // Try structured content
                  if ((res.response as any).structuredContent) {
                    norm = normalizeToGeoJSON(
                      (res.response as any).structuredContent,
                      res.name || "Mapbox Data",
                    );
                  }

                  // Try MCP content blocks
                  if (!norm && Array.isArray((res.response as any).content)) {
                    for (const block of (res.response as any).content) {
                      if (norm) break;
                      if (
                        block.type === "text" &&
                        typeof block.text === "string"
                      ) {
                        const trimmed = block.text.trim();
                        if (
                          trimmed.startsWith("{") ||
                          trimmed.startsWith("[")
                        ) {
                          norm = normalizeToGeoJSON(
                            trimmed,
                            res.name || "Mapbox Data",
                          );
                        }
                        const mapboxUriMatch = trimmed.match(
                          /mapbox:\/\/temp\/[^\s"']+/,
                        );
                        if (!norm && mapboxUriMatch) {
                          norm = await fetchAndNormalizeSpatialUrl(
                            mapboxUriMatch[0],
                            "Mapbox Layer",
                            { resolveMcpResource },
                          );
                        }
                        const httpUrlMatch = trimmed.match(
                          /https:\/\/api\.mapbox\.com\/[^\s"']+/,
                        );
                        if (!norm && httpUrlMatch) {
                          norm = await fetchAndNormalizeSpatialUrl(
                            httpUrlMatch[0],
                            "Mapbox Layer",
                            { resolveMcpResource },
                          );
                        }
                      }
                      if (block.type === "resource" && block.resource) {
                        if (block.resource.text) {
                          norm = normalizeToGeoJSON(
                            block.resource.text,
                            res.name || "Mapbox Data",
                          );
                        } else if (block.resource.uri) {
                          norm = await fetchAndNormalizeSpatialUrl(
                            block.resource.uri,
                            "Mapbox Layer",
                            { resolveMcpResource },
                          );
                        }
                      }
                    }
                  }

                  // Try direct object
                  if (!norm) {
                    norm = normalizeToGeoJSON(res.response, "Mapbox Data");
                  }

                  if (norm?.features?.length > 0) {
                    console.log(
                      `🎯 [ADK Route] Fallback: Adding ${norm.features.length} features to clientToolCommands.`,
                    );
                    clientToolCommands.push({
                      type: "ADD_GEOJSON",
                      payload: {
                        geojson: norm,
                        label: res.name || "Mapbox Layer",
                      },
                    });
                  }
                }
              }
            }
          }

          // Accumulate or capture the final text
          if (event.content && event.content.role === "model") {
            let chunkText = "";
            for (const part of event.content.parts || []) {
              if (part.text) chunkText += part.text;
            }
            if (chunkText) {
              console.log(
                `💬 [ADK Route] Model text from '${agentName}': ${chunkText.substring(0, 100)}...`,
              );
              const prefix =
                finalResponseText.length > 0 &&
                !finalResponseText.endsWith("\n")
                  ? "\n\n"
                  : "";
              finalResponseText += prefix + chunkText;
              sendEvent({ type: "stream", message: prefix + chunkText });
            }
          }

          // Capture and stream agent-level errors (e.g., 429 Quota Exceeded, wrong-agent tool calls)
          const evt = event as any;
          if (evt.errorMessage) {
            const errorCode = evt.errorCode || "UNKNOWN_ERROR";
            console.error(
              `⚠️ [ADK Route] Agent Error from '${agentName}' (${errorCode}): ${evt.errorMessage}`,
            );

            if (evt.errorMessage.includes("is not found in the toolsDict")) {
              routingErrorDetected = true;
              failedAgent = agentName || "unknown_agent";
              failedMessage = evt.errorMessage;
            }

            // Track error separately — don't pollute the success response text
            agentErrors.push({
              agent: agentName || "unknown_agent",
              code: errorCode,
              message: evt.errorMessage,
            });

            // Send a distinct agent_event for the error (not mixed into chat stream)
            sendEvent({
              type: "agent_event",
              event: {
                agentName: agentName || "unknown_agent",
                type: "error",
                description: `❌ Error: ${evt.errorMessage.substring(0, 120)}`,
                errorCode,
                errorMessage: evt.errorMessage,
              },
            });
          }

          if (event.usageMetadata && agentName && agentName !== "user") {
            const tokens = event.usageMetadata.totalTokenCount;
            sendEvent({
              type: "agent_event",
              event: {
                agentName,
                type: "completion",
                description: `✅ Completed task (⚡ ${tokens} tokens)`,
                tokens,
              },
            });
          }

          if (event.usageMetadata) {
            finalUsage.promptTokenCount +=
              event.usageMetadata.promptTokenCount || 0;
            finalUsage.candidatesTokenCount +=
              event.usageMetadata.candidatesTokenCount || 0;
            finalUsage.totalTokenCount +=
              event.usageMetadata.totalTokenCount || 0;
          }
        }

        if (routingErrorDetected && retryCount < maxRetries) {
          retryCount++;
          console.log(`⚠️ [ADK Route] Routing error detected, injecting correction message (Retry ${retryCount})`);
          currentInput = {
            parts: [{ text: `SYSTEM ERROR: The previous action failed because agent "${failedAgent}" tried to call a tool it doesn't have (${failedMessage}). Planner: Please immediately route this task to the CORRECT agent.` }]
          };
          sendEvent({ type: "stream", message: `\n\n> 🔄 *System correcting routing error...*\n\n` });
          continue;
        } else {
          break;
        }
      } // end while

      // ─── Process Spatial Data Buffer (from afterToolCallback interception) ───
        // This data was extracted at the agent level and never went through the LLM.
        if (spatialDataBuffer.length > 0) {
          console.log(
            `\n🚀 [ADK Route] Processing ${spatialDataBuffer.length} intercepted spatial data items from buffer...`,
          );

          for (const item of spatialDataBuffer) {
            // Handle unresolved mapbox:// URIs (need route-level MCP resolver)
            if (
              !item.geojson &&
              item.metadata.summary?.startsWith("mapbox_uri:")
            ) {
              const uri = item.metadata.summary.replace("mapbox_uri:", "");
              console.log(`  🔗 Resolving mapbox URI: ${uri}`);
              try {
                const resolved = await fetchAndNormalizeSpatialUrl(
                  uri,
                  item.label,
                  { resolveMcpResource },
                );
                if (resolved?.features?.length > 0) {
                  clientToolCommands.push({
                    type: "ADD_GEOJSON",
                    payload: { geojson: resolved, label: item.label },
                  });
                  console.log(
                    `  ✅ Resolved and added ${resolved.features.length} features from ${uri}`,
                  );
                }
              } catch (e) {
                console.error(`  ❌ Failed to resolve mapbox URI: ${uri}`, e);
              }
            } else if (item.geojson?.features?.length > 0) {
              // Already normalized GeoJSON — add directly
              // Check for duplicates (avoid adding if route-level fallback already added it)
              const isDuplicate = clientToolCommands.some(
                (cmd) =>
                  cmd.type === "ADD_GEOJSON" &&
                  cmd.payload?.label === item.label,
              );
              if (!isDuplicate) {
                clientToolCommands.push({
                  type: "ADD_GEOJSON",
                  payload: { geojson: item.geojson, label: item.label },
                });
                console.log(
                  `  ✅ Added ${item.geojson.features.length} features from ${item.toolName} (buffer)`,
                );
              }
            }
          }
        }

        // Fallback: If no map command was emitted but user prompt contains a URL, try fetching & normalizing it directly
        const promptUrlMatch = lastMessage.match(/https?:\/\/[^\s"']+/i);
        if (
          promptUrlMatch &&
          !clientToolCommands.some(
            (c) => c.type === "ADD_GEOJSON" || c.type === "LOAD_URL",
          )
        ) {
          try {
            sendEvent({
              type: "status",
              message: "Fetching URL provided in message...",
            });
            const norm = await fetchAndNormalizeSpatialUrl(
              promptUrlMatch[0],
              "User URL Layer",
              { resolveMcpResource },
            );
            if (norm && norm.features && norm.features.length > 0) {
              clientToolCommands.push({
                type: "ADD_GEOJSON",
                payload: { geojson: norm, label: "User URL Layer" },
              });
            }
          } catch (e: any) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("Failed to auto-fetch prompt URL:", e);
            agentErrors.push({
              agent: "route",
              code: "FETCH_FAILED",
              message: `Failed to auto-load URL from your message: ${msg}`,
            });
          }
        }

        sendEvent({ type: "status", message: "Finalizing response..." });

        console.log(
          "📝 [ADK Route] finalResponseText length:",
          finalResponseText.length,
          "| Preview:",
          finalResponseText.substring(0, 150),
        );
        console.log(
          "🚀 [ADK Route] clientToolCommands count:",
          clientToolCommands.length,
        );
        if (agentErrors.length > 0) {
          console.warn(
            `⚠️ [ADK Route] ${agentErrors.length} agent error(s) detected:`,
            agentErrors.map((e) => `${e.agent}:${e.code}`).join(", "),
          );
        }

        sendEvent({
          type: "result",
          data: {
            content: { text: finalResponseText, commands: [] },
            toolCalls: toolCallsMade,
            clientToolCommands: clientToolCommands,
            usage: finalUsage,
            title: activeTitle,
            errors: agentErrors.length > 0 ? agentErrors : undefined,
          },
        });
      } catch (err: any) {
        console.error("[ADK Chat Error]", err);
        sendEvent({
          type: "error",
          message: err.message || "Internal Server Error",
        });
      } finally {
        if (mcpToolsetRef) {
          try {
            await mcpToolsetRef.close();
          } catch (e) {
            console.error("Failed to close MCP Toolset", e);
          }
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
