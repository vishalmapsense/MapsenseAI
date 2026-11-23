import { z } from "zod";
import type { JsonSchemaProperty, JsonSchemaParameters } from "@/config/clientTools/types";

/**
 * Converts a simple JSON Schema property to a Zod schema.
 */
function jsonSchemaToZod(prop: JsonSchemaProperty, isRequired: boolean = false): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (prop.type) {
    case "string":
      schema = z.string();
      if (prop.enum) {
        schema = z.enum(prop.enum as [string, ...string[]]);
      }
      break;
    case "number":
    case "integer":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "array":
      if (prop.items) {
        schema = z.array(jsonSchemaToZod(prop.items, true));
      } else {
        schema = z.array(z.any());
      }
      break;
    case "object":
      if (prop.properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        const requiredFields = prop.required || [];
        for (const [key, val] of Object.entries(prop.properties)) {
          shape[key] = jsonSchemaToZod(val, requiredFields.includes(key));
        }
        schema = z.object(shape);
      } else {
        schema = z.record(z.string(), z.any());
      }
      break;
    default:
      schema = z.any();
  }

  if (prop.description) {
    schema = schema.describe(prop.description);
  }

  if (!isRequired) {
    schema = schema.optional();
  }

  return schema;
}

/**
 * Converts a tool's JSON Schema parameters to a Zod object schema.
 */
export function convertParametersToZod(parameters: JsonSchemaParameters): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const requiredFields = parameters.required || [];

  for (const [key, prop] of Object.entries(parameters.properties)) {
    shape[key] = jsonSchemaToZod(prop, requiredFields.includes(key));
  }

  return z.object(shape);
}
