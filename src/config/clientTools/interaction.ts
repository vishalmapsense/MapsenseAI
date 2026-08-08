import type { ClientToolDefinition } from "./types";

export const INTERACTION_TOOLS: ClientToolDefinition[] = [
  {
    type: "function",
    name: "request_user_permission",
    description: "Request explicit permission from the user before executing a critical, destructive, or heavy action. This pauses execution and shows a UI modal. You MUST call this BEFORE any guarded tool (e.g., map_clear_layers, map_delete_geometry). The execution will stop and wait for the user's response.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "A short, descriptive title for the permission request.",
        },
        message: {
          type: "string",
          description: "The main message explaining what will happen and why permission is needed. Be specific about consequences (e.g., 'This will permanently delete all layers from the map and database').",
        },
        options: {
          type: "array",
          items: {
            type: "string",
          },
          description: "An array of 2 to 4 short string options for the user to choose from (e.g. ['Yes, proceed', 'No, cancel']).",
        },
        for_tool: {
          type: "string",
          description: "The name of the guarded tool that requires permission (e.g., 'map_clear_layers', 'map_delete_geometry'). This is REQUIRED when requesting permission for a destructive tool.",
        },
      },
      required: ["title", "message", "options"],
    },
    strict: true,
  },
];
