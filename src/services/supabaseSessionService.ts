/**
 * SupabaseSessionService
 * ─────────────────────────────────────────────────────────────
 * Custom ADK BaseSessionService implementation backed by Supabase.
 * Replaces MikroORM / SQLite with HTTPS Supabase REST API calls.
 * 
 * Works reliably in Serverless (AWS Lambda / Amplify) environments
 * where raw TCP sockets, SQLite files, or IPv6 are unavailable or ephemeral.
 * ─────────────────────────────────────────────────────────────
 */

import {
  BaseSessionService,
  createSession,
  type Session,
  type Event,
  type CreateSessionRequest,
  type GetSessionRequest,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type DeleteSessionRequest,
  type AppendEventRequest,
} from "@google/adk";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

function getSupabaseClient(): SupabaseClient {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://socopvqqhgehxflnyezr.supabase.co";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  return createClient(url, key);
}

export class SupabaseSessionService extends BaseSessionService {
  private supabase: SupabaseClient;

  constructor(customClient?: SupabaseClient) {
    super();
    this.supabase = customClient || getSupabaseClient();
  }

  async createSession({
    appName,
    userId,
    state,
    sessionId,
  }: CreateSessionRequest): Promise<Session> {
    const id = sessionId || crypto.randomUUID();
    const now = new Date();

    // Check if session already exists
    const { data: existing } = await this.supabase
      .from("sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (existing) {
      return this.getSession({ appName, userId, sessionId: id }) as Promise<Session>;
    }

    const sessionState = state || {};

    const { error } = await this.supabase.from("sessions").insert({
      id,
      app_name: appName,
      user_id: userId,
      state: sessionState,
      create_time: now.toISOString(),
      update_time: now.toISOString(),
    });

    if (error) {
      console.error("[SupabaseSessionService] Error creating session in Supabase:", error);
    }

    return createSession({
      id,
      appName,
      userId,
      state: sessionState,
      events: [],
      lastUpdateTime: now.getTime(),
    });
  }

  async getSession({
    appName,
    userId,
    sessionId,
    config,
  }: GetSessionRequest): Promise<Session | undefined> {
    try {
      // 1. Fetch session record
      const { data: sessionData, error: sErr } = await this.supabase
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle();

      if (sErr || !sessionData) {
        return undefined;
      }

      // If userId is provided, ensure session belongs to user (support comma-separated userIds for email/UUID)
      if (userId) {
        const allowedIds = userId.split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);
        const recordUserId = (sessionData.user_id || "").toLowerCase();
        if (allowedIds.length > 0 && !allowedIds.includes(recordUserId)) {
          // If neither matches, return undefined
          return undefined;
        }
      }

      // 2. Fetch events for this session
      let query = this.supabase
        .from("events")
        .select("id, app_name, user_id, session_id, invocation_id, timestamp, event_data")
        .eq("session_id", sessionId)
        .order("timestamp", { ascending: true });

      if (config?.afterTimestamp) {
        query = query.gt("timestamp", new Date(config.afterTimestamp).toISOString());
      }
      if (config?.numRecentEvents) {
        query = query.limit(config.numRecentEvents);
      }

      const { data: eventRows, error: eErr } = await query;
      if (eErr) {
        console.error("[SupabaseSessionService] Error fetching events:", eErr);
      }

      const events: Event[] = (eventRows || []).map((row: any) => {
        const evt = row.event_data || {};
        return {
          id: row.id || evt.id,
          invocationId: row.invocation_id || evt.invocationId,
          timestamp: row.timestamp ? new Date(row.timestamp).getTime() : Date.now(),
          ...evt,
        };
      });

      const updateTimeMs = sessionData.update_time
        ? new Date(sessionData.update_time).getTime()
        : Date.now();

      return createSession({
        id: sessionData.id,
        appName: sessionData.app_name || appName || "MapsenseADK",
        userId: sessionData.user_id || userId || "",
        state: sessionData.state || {},
        events,
        lastUpdateTime: updateTimeMs,
      });
    } catch (err) {
      console.error("[SupabaseSessionService] getSession exception:", err);
      return undefined;
    }
  }

  async listSessions({
    appName,
    userId,
    limit,
    offset,
    page,
    order = "desc",
  }: ListSessionsRequest): Promise<ListSessionsResponse> {
    try {
      let query = this.supabase
        .from("sessions")
        .select("*", { count: "exact" });

      if (appName) {
        query = query.eq("app_name", appName);
      }

      if (userId) {
        const ids = userId.split(",").map((u) => u.trim()).filter(Boolean);
        if (ids.length > 1) {
          query = query.or(ids.map((id) => `user_id.eq.${id}`).join(","));
        } else if (ids.length === 1) {
          query = query.eq("user_id", ids[0]);
        }
      }

      query = query.order("update_time", { ascending: order === "asc" });

      if (limit !== undefined) {
        const from = offset || 0;
        query = query.range(from, from + limit - 1);
      }

      const { data, count, error } = await query;

      const totalItems = count ?? (data ? data.length : 0);
      const effectiveLimit = limit !== undefined ? limit : totalItems;
      const totalPages = effectiveLimit === 0 ? 0 : Math.ceil(totalItems / effectiveLimit);
      const effectivePage = page !== undefined ? page : 1;

      if (error) {
        console.error("[SupabaseSessionService] Error listing sessions:", error);
        return {
          sessions: [],
          page: effectivePage,
          limit: effectiveLimit,
          totalItems: 0,
          totalPages: 0,
        };
      }

      const sessions: Session[] = (data || []).map((s: any) =>
        createSession({
          id: s.id,
          appName: s.app_name,
          userId: s.user_id,
          state: s.state || {},
          events: [],
          lastUpdateTime: s.update_time
            ? new Date(s.update_time).getTime()
            : Date.now(),
        })
      );

      return {
        sessions,
        page: effectivePage,
        limit: effectiveLimit,
        totalItems,
        totalPages,
      };
    } catch (err) {
      console.error("[SupabaseSessionService] listSessions exception:", err);
      return {
        sessions: [],
        page: 1,
        limit: 0,
        totalItems: 0,
        totalPages: 0,
      };
    }
  }

  async deleteSession({
    sessionId,
  }: DeleteSessionRequest): Promise<void> {
    try {
      // 1. Delete events
      await this.supabase.from("events").delete().eq("session_id", sessionId);
      // 2. Delete session
      await this.supabase.from("sessions").delete().eq("id", sessionId);
      // 3. Delete session_layers
      await this.supabase.from("session_layers").delete().eq("session_id", sessionId);
    } catch (err) {
      console.error("[SupabaseSessionService] deleteSession exception:", err);
    }
  }

  async appendEvent({
    session,
    event,
  }: AppendEventRequest): Promise<Event> {
    // Maintain ADK in-memory state on the session object
    await super.appendEvent({ session, event });

    try {
      const eventId = event.id || crypto.randomUUID().slice(0, 8);
      const invocationId = (event as any).invocationId || crypto.randomUUID();
      const eventTimestamp = event.timestamp
        ? new Date(event.timestamp).toISOString()
        : new Date().toISOString();

      // Ensure session exists in Supabase before attaching event
      const { data: existingSession } = await this.supabase
        .from("sessions")
        .select("id")
        .eq("id", session.id)
        .maybeSingle();

      if (!existingSession) {
        await this.supabase.from("sessions").insert({
          id: session.id,
          app_name: session.appName || "MapsenseADK",
          user_id: session.userId,
          state: session.state || {},
          create_time: eventTimestamp,
          update_time: eventTimestamp,
        });
      }

      // 1. Persist the event into Supabase events table
      const { error: evtErr } = await this.supabase.from("events").insert({
        id: eventId,
        app_name: session.appName || "MapsenseADK",
        user_id: session.userId,
        session_id: session.id,
        invocation_id: invocationId,
        timestamp: eventTimestamp,
        event_data: event,
      });

      if (evtErr) {
        console.error("[SupabaseSessionService] Error persisting event to Supabase:", evtErr);
      }

      // 2. Update session state and update_time in sessions table
      const { error: sUpdateErr } = await this.supabase
        .from("sessions")
        .update({
          state: session.state || {},
          update_time: eventTimestamp,
        })
        .eq("id", session.id);

      if (sUpdateErr) {
        console.error("[SupabaseSessionService] Error updating session state in Supabase:", sUpdateErr);
      }
    } catch (err) {
      console.error("[SupabaseSessionService] appendEvent exception:", err);
    }

    return event;
  }
}
