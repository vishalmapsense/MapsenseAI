/**
 * Utility to strip internal system tags, map query context, and layer definitions
 * from chat messages so that only genuine user input and clean AI responses are shown.
 */
export function cleanMessageContent(text: string): string {
  if (!text) return "";
  return text
    .replace(/\[MAP_SQL_CONTEXT\][\s\S]*?\[\/MAP_SQL_CONTEXT\]/gi, "")
    .replace(/\[MAP_SQL_CONTEXT\][\s\S]*/gi, "")
    .replace(/\[SELECTED_MAP_LAYERS\][\s\S]*?\[\/SELECTED_MAP_LAYERS\]/gi, "")
    .replace(/\[SELECTED_MAP_LAYERS\][\s\S]*/gi, "")
    .replace(/\[ATTACHED_BOUNDARY_CONTEXT\][\s\S]*?\[\/ATTACHED_BOUNDARY_CONTEXT\]/gi, "")
    .replace(/\[ATTACHED_LOCAL_FILES\][\s\S]*?\[\/ATTACHED_LOCAL_FILES\]/gi, "")
    .replace(/\[(?:OPTION|SUGGESTION|CHOICE):\s*([^\]]+)\]/gi, "")
    .trim();
}

/**
 * Checks whether a message is an internal system message (e.g. separator or pure context injection)
 * that should not be displayed in the user chat.
 */
export function isInternalOrEmptyMessage(role: string, rawContent: string): boolean {
  if (!rawContent || !rawContent.trim()) return true;
  if (role === "assistant" && rawContent.includes("📍 **Map SQL Query**")) return true;
  if (role === "user") {
    const cleaned = cleanMessageContent(rawContent);
    if (!cleaned) return true;
  }
  return false;
}
