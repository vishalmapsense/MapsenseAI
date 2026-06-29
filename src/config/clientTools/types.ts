/**
 * Client Tool Types
 * ─────────────────────────────────────────────────────────────
 * Provider-agnostic type definitions for client-side tools.
 * Uses standard JSON Schema format compatible with both
 * OpenAI and Gemini function calling APIs.
 * ─────────────────────────────────────────────────────────────
 */

/**
 * Standard JSON Schema property definition.
 */
export interface JsonSchemaProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Standard JSON Schema parameter definition for a function.
 */
export interface JsonSchemaParameters {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * A single client tool definition using OpenAI-style format.
 * Provider-agnostic — converted to Gemini FunctionDeclaration at runtime.
 */
export interface ClientToolDefinition {
  /** Always "function" for callable tools */
  type: "function";
  /** Tool name — must be unique across all tools. Client tools use "map_" prefix. */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema for the tool's parameters */
  parameters: JsonSchemaParameters;
  /** When true, the model must provide all required parameters */
  strict: boolean;
}
