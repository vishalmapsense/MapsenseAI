/**
 * Tool Guardrail — beforeToolCallback
 * ─────────────────────────────────────────────────────────────
 * Programmatically blocks destructive / heavy / critical tools
 * BEFORE they execute. The LLM's tool call is intercepted and
 * a "BLOCKED" response is returned, forcing the agent to call
 * `request_user_permission` first.
 *
 * Permission state is tracked via ADK session state:
 *   state["_guard_granted:<tool_name>"] = true
 *
 * When `request_user_permission` is called with `for_tool`,
 * the afterToolCallback sets the grant flag. On the next
 * invocation (after user approves), the guarded tool is allowed.
 *
 * Used by: adkAgent.ts → beforeToolCallback on all agents
 * ─────────────────────────────────────────────────────────────
 */

import type { BaseTool } from "@google/adk";

/**
 * Tools that MUST receive explicit user permission before execution.
 * Add any tool name here that is destructive, heavy, or critical.
 */
export const GUARDED_TOOLS = new Set([
  "map_clear_layers",
  "map_delete_geometry",
]);

/**
 * Maximum number of times a single tool can be called within one agent invocation.
 * Prevents infinite retry loops where the LLM keeps calling the same tool.
 */
const MAX_TOOL_CALLS_PER_INVOCATION = 5;

/**
 * Per-invocation tool call counter.
 * Tracks how many times each tool has been called in the current request.
 * Must be reset at the start of each new request via resetToolCallCounters().
 */
const _toolCallCounts = new Map<string, number>();

/** Reset tool call counters — call this at the start of each new request. */
export function resetToolCallCounters(): void {
  _toolCallCounts.clear();
}

/** Session state key prefix for tracking granted permissions */
const GRANT_KEY_PREFIX = "_guard_granted:";

/**
 * Returns the session state key for a given tool name.
 */
export function grantKey(toolName: string): string {
  return `${GRANT_KEY_PREFIX}${toolName}`;
}

/**
 * beforeToolCallback — blocks guarded tools unless permission was granted.
 *
 * If the tool is in GUARDED_TOOLS and session state does NOT have
 * `_guard_granted:<tool_name> = true`, it returns a BLOCKED response
 * (the ADK framework skips the tool call and uses this as the result).
 *
 * If permission WAS granted, it clears the grant flag (one-time use)
 * and allows execution by returning undefined.
 */
export const toolGuardrailCallback = async (params: {
  tool: BaseTool;
  args: Record<string, unknown>;
  context: any; // ADK Context
}): Promise<Record<string, unknown> | undefined> => {
  const toolName = params.tool?.name;

  // 0. Hard Tool Call Limit: Prevent infinite retry loops
  if (toolName) {
    const count = (_toolCallCounts.get(toolName) || 0) + 1;
    _toolCallCounts.set(toolName, count);
    if (count > MAX_TOOL_CALLS_PER_INVOCATION) {
      console.log(`⛔ [Guardrail] HARD LIMIT: Tool "${toolName}" called ${count} times (max: ${MAX_TOOL_CALLS_PER_INVOCATION}). Blocking.`);
      return {
        status: "BLOCKED_MAX_RETRIES",
        error: `HARD SYSTEM LIMIT: You have already called "${toolName}" ${MAX_TOOL_CALLS_PER_INVOCATION} times in this request. ` +
          `You MUST STOP retrying and return your best answer or error summary to the user NOW. ` +
          `Do NOT attempt to call this tool again. Summarize what you tried and what failed.`,
      };
    }
  }

  // 1. Hard Safety Limit Guardrail: Protect against unreasonable / system-crashing operations
  const limitArg = (params.args?.limit || params.args?.count || params.args?.maxResults || params.args?.batchSize) as number | undefined;
  if (limitArg && typeof limitArg === "number" && limitArg > 250) {
    console.log(`⛔ [Guardrail] HARD REJECTION: Tool "${toolName}" requested limit ${limitArg} which exceeds max safe threshold (250).`);
    return {
      status: "REJECTED_SAFETY_LIMIT",
      error: `HARD SYSTEM BOUNDARY EXCEEDED: The requested limit of ${limitArg} items/calls exceeds the maximum safety threshold of 250 per request. ` +
        `Even if the user granted permission or requested it, you CANNOT run this request. ` +
        `You MUST inform the user politely that the system cannot execute more than 250 items/calls at once to prevent server degradation, and offer a smaller batch.`,
    };
  }

  // 1b. Disallowed Tools Guardrail: render_map_tool is for Claude iframe, not Mapsense
  if (toolName === "render_map_tool" || toolName === "static_map_image_tool") {
    console.log(`⛔ [Guardrail] DISALLOWED TOOL: "${toolName}" is blocked in MapsenseAI.`);
    return {
      status: "BLOCKED_DISALLOWED_TOOL",
      error: `The tool "${toolName}" is disabled in MapsenseAI. Do NOT attempt to render maps or call this tool. ` +
        `Spatial data is automatically intercepted and rendered onto the DeckGL map by the system. ` +
        `Simply return your technical findings/summary to planner_agent.`,
    };
  }

  // 1c. DuckDB Engine Guardrail: Intercept backend run_duck_db_queries targeting client-side map layers
  if (toolName === "run_duck_db_queries") {
    const queryText = (params.args?.queryText as string) || "";
    const isClientTable = /\b(map_features|layers|layer_\d+|nawabganj[_\w]*)\b/i.test(queryText);
    if (isClientTable) {
      console.log(`⛔ [Guardrail] BLOCKED run_duck_db_queries targeting client map layer: "${queryText}".`);
      return {
        status: "BLOCKED_WRONG_DUCKDB_ENGINE",
        error: `WRONG DUCKDB ENGINE: The table referenced in your SQL query is a client-side map layer in the user's browser. ` +
          `It does NOT exist on the backend database. You MUST call "run_client_duckdb_query" with this query instead of "run_duck_db_queries". ` +
          `Client DuckDB-Wasm already has this layer loaded in the browser. Call "run_client_duckdb_query" now.`,
      };
    }
  }

  if (!toolName || !GUARDED_TOOLS.has(toolName)) {
    return undefined; // Not guarded — allow execution
  }

  // Check session state for a prior permission grant
  const key = grantKey(toolName);
  const state = params.context?.state;

  if (state && state[key] === true) {
    // Permission was granted — consume the grant (one-time) and allow
    console.log(`🛡️ [Guardrail] Permission GRANTED for "${toolName}" — allowing execution.`);
    state[key] = false; // Reset so next call requires fresh permission
    return undefined; // Allow the actual tool to execute
  }

  // BLOCKED — tell the LLM it must ask permission first
  console.log(`🚫 [Guardrail] BLOCKED "${toolName}" — no permission granted. Agent must call request_user_permission first.`);
  return {
    status: "BLOCKED",
    error: `EXECUTION BLOCKED: "${toolName}" is a critical/destructive action that can cause data loss. ` +
      `You MUST call the "request_user_permission" tool FIRST with for_tool="${toolName}" to get explicit user consent. ` +
      `Do NOT attempt to call "${toolName}" again until the user grants permission via the modal. ` +
      `Include a clear explanation of what will happen (e.g., "This will permanently delete all layers from the map and Supabase database").`,
  };
};

/**
 * NOTE: permissionGrantCallback was REMOVED.
 * ─────────────────────────────────────────────────────────────
 * The grant flag is now set in route.ts ONLY when the user
 * actually responds to the permission modal (not eagerly when
 * the agent calls request_user_permission).
 *
 * This prevents:
 *  1. Actions executing before the user grants permission
 *  2. Infinite permission loops on subsequent turns
 * ─────────────────────────────────────────────────────────────
 */
