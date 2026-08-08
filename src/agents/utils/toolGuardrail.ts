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
 * afterToolCallback for `request_user_permission` — sets the grant flag
 * in session state when the agent requests permission for a guarded tool.
 *
 * This runs AFTER request_user_permission is "executed" (it's a client tool,
 * so it just returns a placeholder). The grant flag is set here so that
 * when the user responds (next invocation), the guarded tool is unblocked.
 */
export const permissionGrantCallback = async (params: {
  tool: BaseTool;
  args: Record<string, unknown>;
  context: any; // ADK Context
  response: Record<string, unknown>;
}): Promise<Record<string, unknown> | undefined> => {
  if (params.tool?.name !== "request_user_permission") {
    return undefined; // Not our tool — pass through
  }

  const forTool = params.args?.for_tool as string | undefined;
  if (forTool && GUARDED_TOOLS.has(forTool)) {
    const key = grantKey(forTool);
    const state = params.context?.state;
    if (state) {
      state[key] = true;
      console.log(`🔑 [Guardrail] Permission flag SET for "${forTool}" — will be allowed on next invocation.`);
    }
  }

  return undefined; // Don't modify the tool response
};
