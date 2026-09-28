import React from "react";
import { toast } from "sonner";
import { Database } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { QueryResultData } from "@/types/mcp.types";
import { enrichQueryResultWithSpatial } from "@/utils/spatialQueryHelper";

export const TEN_MB_BYTES = 10 * 1024 * 1024; // 10 MB in bytes

/**
 * Calculate the exact UTF-8 byte size of a QueryResultData object.
 */
export function calculateQueryResultSize(result: QueryResultData): {
  bytes: number;
  sizeMb: string;
  formatted: string;
} {
  try {
    const serialized = JSON.stringify(result);
    const bytes = new TextEncoder().encode(serialized).length;
    const sizeMb = (bytes / (1024 * 1024)).toFixed(1);
    const formatted =
      bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${sizeMb} MB`;
    return { bytes, sizeMb, formatted };
  } catch {
    return { bytes: 0, sizeMb: "0.0", formatted: "0 KB" };
  }
}

/**
 * Prompt user when a query result exceeds 10 MB before saving to Supabase.
 */
export function promptLargeQueryResultSave(
  userId: string,
  sessionId: string | null,
  result: QueryResultData
): void {
  const { formatted } = calculateQueryResultSize(result);
  const toastId = `large-query-confirm-${sessionId || "session"}-${result.queryId}`;

  const queryTitle = result.queryText
    ? result.queryText.trim().replace(/[\r\n]+/g, " ").substring(0, 38) + (result.queryText.length > 38 ? "…" : "")
    : `Query (${result.rowCount.toLocaleString()} rows)`;

  toast.custom(
    () => (
      <div className="w-[350px] sm:w-[410px] rounded-xl border border-border bg-popover text-popover-foreground p-4 shadow-xl flex flex-col gap-3 font-sans">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/15 text-amber-500 shrink-0 mt-0.5 border border-amber-500/30">
            <Database className="w-5 h-5" />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold text-sm leading-tight text-foreground truncate" title={queryTitle}>
                Large Result: {queryTitle}
              </h4>
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0">
                {formatted}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-normal">
              Data size is <strong className="text-foreground">{formatted}</strong> ({result.rowCount.toLocaleString()} rows), which exceeds the 10 MB limit. Save to Supabase cloud?
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
          <button
            onClick={() => {
              toast.dismiss(toastId);
              toast.info(`Query result (${formatted}) kept in session memory only.`);
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 transition-colors cursor-pointer"
          >
            Session Only
          </button>
          <button
            onClick={() => {
              toast.dismiss(toastId);
              const savePromise = queryResultService.saveResult(userId, sessionId, result, true);
              toast.promise(savePromise, {
                loading: `Saving query result (${formatted}) to cloud...`,
                success: `Query result (${formatted}) saved successfully`,
                error: (err: any) =>
                  `Failed to save to cloud: ${err?.message || "Storage error"}`,
              });
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
          >
            Save Anyway
          </button>
        </div>
      </div>
    ),
    {
      id: toastId,
      duration: Infinity,
    }
  );
}

/**
 * Service to manage saving, fetching, and deleting query results in Supabase.
 */
export const queryResultService = {
  /**
   * Save a query result to Supabase.
   * If data size > 10MB and !forceSave:
   * - Does NOT directly save to Supabase.
   * - Prompts user via toast confirmation showing exact data size.
   */
  async saveResult(
    userId: string,
    sessionId: string | null,
    result: QueryResultData,
    forceSave: boolean = false
  ): Promise<boolean> {
    const { bytes, formatted } = calculateQueryResultSize(result);

    // If data exceeds 10 MB and user hasn't explicitly confirmed:
    if (bytes > TEN_MB_BYTES && !forceSave) {
      console.warn(
        `[QueryResultSync] ℹ️ Query result ${result.queryId} size is ${formatted} (> 10 MB). Requesting user confirmation for cloud save.`
      );
      promptLargeQueryResultSave(userId, sessionId, result);
      return false;
    }

    const supabase = createClient();
    const enriched = enrichQueryResultWithSpatial(result);

    const { error } = await supabase.from("query_results").insert({
      user_id: userId,
      session_id: sessionId,
      query_id: enriched.queryId,
      query_text: enriched.queryText,
      columns: enriched.columns,
      rows: enriched.rows,
      row_count: enriched.rowCount,
      total_row_count: enriched.totalRowCount,
      truncated: enriched.truncated,
      execution_time_ms: enriched.executionTimeMs,
      tool_name: enriched.toolName,
      timestamp: enriched.timestamp,
      has_spatial_column: enriched.hasSpatialColumn,
      spatial_column_name: enriched.spatialColumnName,
    });

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST204") {
        console.warn("query_results table does not exist yet. Not saving.");
        return false;
      }
      console.error("Failed to save query result to Supabase:", error);
      throw error;
    }

    return true;
  },

  /**
   * Fetch all query results for a specific session
   */
  async fetchResultsBySession(userId: string, sessionId: string): Promise<QueryResultData[]> {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("query_results")
      .select("*")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .order("timestamp", { ascending: false });

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST204") {
        console.warn("query_results table does not exist yet. Returning empty results.");
        return [];
      }
      console.error(
        "Failed to fetch query results from Supabase:",
        error.message || error.details || JSON.stringify(error)
      );
      return [];
    }

    if (!data) return [];

    return data.map((row) => {
      const baseResult: QueryResultData = {
        queryId: row.query_id,
        queryText: row.query_text,
        columns: row.columns,
        rows: row.rows,
        rowCount: row.row_count,
        totalRowCount: row.total_row_count,
        truncated: row.truncated,
        executionTimeMs: row.execution_time_ms,
        toolName: row.tool_name,
        timestamp: row.timestamp,
        hasSpatialColumn: row.has_spatial_column,
        spatialColumnName: row.spatial_column_name,
      };
      return enrichQueryResultWithSpatial(baseResult);
    });
  },

  /**
   * Delete a query result from Supabase
   */
  async deleteResult(userId: string, queryId: string): Promise<void> {
    const supabase = createClient();

    const { error } = await supabase
      .from("query_results")
      .delete()
      .eq("user_id", userId)
      .eq("query_id", queryId);

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST204") {
        return;
      }
      console.error("Failed to delete query result from Supabase:", error);
      throw error;
    }
  },
};
