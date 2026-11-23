import { MCPTool } from "@/types/mcp.types";
import { FunctionDeclaration, Schema, SchemaType } from "@google/generative-ai";

/**
 * Maps MCP JSON Schema types to Google Generative AI SchemaTypes.
 */
function mapTypeToGemini(type?: string): SchemaType {
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
      return SchemaType.STRING; // Fallback
  }
}

/**
 * Recursively converts a standard JSON Schema into Gemini's Schema format.
 */
function convertJsonSchemaToGeminiSchema(jsonSchema: any): any {
  if (!jsonSchema) return { type: SchemaType.OBJECT, properties: {} };

  let description = jsonSchema.description || "";
  
  // Gemini's SDK doesn't natively support min/max/default, so we inject them into the description
  const extras: string[] = [];
  if (jsonSchema.default !== undefined) extras.push(`Default: ${JSON.stringify(jsonSchema.default)}`);
  if (jsonSchema.minimum !== undefined) extras.push(`Min: ${jsonSchema.minimum}`);
  if (jsonSchema.maximum !== undefined) extras.push(`Max: ${jsonSchema.maximum}`);
  
  if (extras.length > 0) {
    description = description ? `${description} (${extras.join(", ")})` : `(${extras.join(", ")})`;
  }

  const schema: any = {
    type: mapTypeToGemini(jsonSchema.type),
  };
  
  if (description) {
    schema.description = description;
  }

  if (schema.type === SchemaType.OBJECT) {
    schema.properties = {};
    if (jsonSchema.properties) {
      for (const [key, value] of Object.entries(jsonSchema.properties)) {
        schema.properties[key] = convertJsonSchemaToGeminiSchema(value);
      }
    }
  }

  if (jsonSchema.required && Array.isArray(jsonSchema.required)) {
    schema.required = jsonSchema.required;
  }

  if (schema.type === SchemaType.ARRAY && jsonSchema.items) {
    schema.items = convertJsonSchemaToGeminiSchema(jsonSchema.items);
  }

  if (jsonSchema.enum && Array.isArray(jsonSchema.enum)) {
    schema.enum = jsonSchema.enum.map(String); // Gemini expects string enums
  }

  return schema;
}

/**
 * Converts a list of MCPTools to a list of Gemini FunctionDeclarations.
 */
export function convertMCPToolsToGeminiTools(mcpTools: MCPTool[]): FunctionDeclaration[] {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description || `Tool ${tool.name}`,
    parameters: convertJsonSchemaToGeminiSchema(tool.inputSchema) as any,
  }));
}
