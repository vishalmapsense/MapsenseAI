/**
 * Client Tools — Barrel Export & Runtime Converter
 * ─────────────────────────────────────────────────────────────
 * Merges all client tool declarations from individual files,
 * converts them from standard JSON Schema → Gemini format,
 * and exposes helpers for the chat route.
 * ─────────────────────────────────────────────────────────────
 */

import { SchemaType, type FunctionDeclaration } from "@google/generative-ai";
import { NAVIGATION_TOOLS } from "./navigation";
import { LAYER_TOOLS } from "./layers";
import { DRAWING_TOOLS } from "./drawing";
import type { ClientToolDefinition, JsonSchemaProperty, JsonSchemaParameters } from "@/config/clientTools/types";
import type { MCPTool } from "@/types/mcp.types";

// ─── Raw Definitions (Provider-Agnostic) ──────────────────────

export const CLIENT_TOOL_DEFINITIONS: ClientToolDefinition[] = [
  ...NAVIGATION_TOOLS,
  ...LAYER_TOOLS,
  ...DRAWING_TOOLS,
];

// ─── JSON Schema → Gemini Schema Converter ────────────────────

function mapTypeToGemini(type: string): SchemaType {
  switch (type) {
    case "string":
      return SchemaType.STRING;
    case "number":
    case "integer":
      return SchemaType.NUMBER;
    case "boolean":
      return SchemaType.BOOLEAN;
    case "array":
      return SchemaType.ARRAY;
    case "object":
      return SchemaType.OBJECT;
    default:
      return SchemaType.STRING;
  }
}

function convertParamsToGemini(params: JsonSchemaParameters): any {
  const schema: any = {
    type: SchemaType.OBJECT,
    properties: {},
  };

  for (const [key, prop] of Object.entries(params.properties)) {
    schema.properties[key] = convertPropertyToGemini(prop);
  }

  if (params.required && params.required.length > 0) {
    schema.required = params.required;
  }

  return schema;
}

function convertPropertyToGemini(prop: JsonSchemaProperty): any {
  const result: any = {
    type: mapTypeToGemini(prop.type),
  };
  if (prop.description) result.description = prop.description;
  if (prop.enum) result.enum = prop.enum;
  if (prop.items) result.items = convertPropertyToGemini(prop.items);
  if (prop.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(prop.properties)) {
      result.properties[key] = convertPropertyToGemini(value);
    }
  }
  if (prop.required) result.required = prop.required;
  return result;
}

function toGeminiFunctionDeclaration(tool: ClientToolDefinition): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: convertParamsToGemini(tool.parameters),
  };
}

// ─── Gemini-Ready Declarations ────────────────────────────────

export const ALL_CLIENT_TOOLS: FunctionDeclaration[] =
  CLIENT_TOOL_DEFINITIONS.map(toGeminiFunctionDeclaration);

/**
 * Returns all client tools in standard MCP (Model Context Protocol) format.
 * This makes the tools agnostic and consumable by ANY external LLM (Claude, OpenAI, etc.)
 * that supports the MCP specification, rather than being Gemini-specific.
 */
export function getClientToolsAsMCP(): MCPTool[] {
  return CLIENT_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      properties: tool.parameters.properties,
      ...(tool.parameters.required ? { required: tool.parameters.required } : {}),
    },
  }));
}

// ─── Lookup Set (for O(1) checks) ─────────────────────────────

const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOL_DEFINITIONS.map((t) => t.name));

/**
 * Check if a tool name belongs to a client-side tool.
 */
export function isClientTool(name: string): boolean {
  return CLIENT_TOOL_NAMES.has(name);
}

/**
 * Generate a synthetic "success" function response for a client tool call.
 * This is sent back to the LLM so it knows the tool was handled.
 */
export function buildClientToolResponse(
  toolName: string,
  args: Record<string, unknown>
): object {
  return {
    status: "success",
    tool: toolName,
    message: `Client action '${toolName}' has been queued for execution on the map. CRITICAL: Do NOT generate a text response describing this action to the user. The client UI will handle the confirmation message automatically.`,
    appliedArgs: args,
  };
}

// ─── Re-exports ───────────────────────────────────────────────

export { NAVIGATION_TOOLS } from "./navigation";
export { LAYER_TOOLS } from "./layers";
export { DRAWING_TOOLS } from "./drawing";
export type { ClientToolDefinition } from "./types";
