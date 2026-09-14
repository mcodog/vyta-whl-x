import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * API error logging.
 * ==================
 * Records every failure of an admin/warehouse API function into `error_log`
 * so failures are visible in the admin Error Logs dashboard instead of only
 * living in server console output. Writes are best-effort and must NEVER throw
 * out of the logging path — a failure to record an error must not mask (or
 * replace) the original error.
 */

export interface ErrorEntryInput {
  /** Coarse bucket the error belongs to, e.g. "customers", "invoices". */
  area: string;
  /** Request path, e.g. "/api/admin/customers/123". */
  route?: string | null;
  /** HTTP method, e.g. "POST". */
  method?: string | null;
  /** Response status returned to the client (defaults to 500). */
  status_code?: number | null;
  /** The thrown value / error. */
  error: unknown;
  /** Acting user id when known. */
  actor_id?: string | null;
  /** Optional sanitized request context. */
  payload?: Record<string, unknown> | null;
}

/** Pull a readable message out of any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Pull a stack trace when the thrown value is an Error. */
function errorStack(error: unknown): string | null {
  return error instanceof Error && error.stack ? error.stack : null;
}

/**
 * Derive a coarse "area" from an API route path. `/api/admin/customers/123` ->
 * "customers"; `/api/warehouse/queue/9` -> "warehouse". Falls back to the last
 * meaningful segment so unknown routes still bucket sensibly.
 */
export function areaFromRoute(route: string | null | undefined): string {
  if (!route) return "unknown";
  const parts = route.split("?")[0].split("/").filter(Boolean);
  const apiIdx = parts.indexOf("api");
  const rest = apiIdx >= 0 ? parts.slice(apiIdx + 1) : parts;
  // Skip the surface prefix ("admin" / "warehouse") to get the resource name,
  // but keep the surface as a prefix so identical resource names don't collide.
  if (rest.length === 0) return "unknown";
  const surface = rest[0];
  if ((surface === "admin" || surface === "warehouse") && rest.length > 1) {
    return surface === "warehouse" ? "warehouse" : rest[1];
  }
  return rest[0];
}

/**
 * Build a stable fingerprint for grouping repeated errors. The message is
 * normalized so dynamic bits (uuids, numbers, quoted values) don't fragment
 * otherwise-identical errors into separate groups.
 */
export function errorFingerprint(area: string, message: string): string {
  const normalized = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/["'`][^"'`]*["'`]/g, "<v>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  // Small, dependency-free hash (djb2) rendered as base36.
  let hash = 5381;
  const basis = `${area}::${normalized}`;
  for (let i = 0; i < basis.length; i++) {
    hash = (hash * 33) ^ basis.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Append-only error writer. Swallows its own failures. Always called
 * server-side with a service-role supabase client.
 */
export async function logErrorServer(
  supabase: SupabaseClient,
  entry: ErrorEntryInput,
): Promise<void> {
  try {
    const message = errorMessage(entry.error);
    const area = entry.area || areaFromRoute(entry.route);
    const { error } = await supabase.from("error_log").insert({
      area,
      route: entry.route ?? null,
      method: entry.method ?? null,
      status_code: entry.status_code ?? 500,
      message,
      stack: errorStack(entry.error),
      fingerprint: errorFingerprint(area, message),
      actor_id: entry.actor_id ?? null,
      payload: entry.payload ?? null,
    });
    if (error) console.error("logErrorServer error:", error);
  } catch (e) {
    console.error("logErrorServer crashed:", e);
  }
}

// A service-role client used only by the route wrapper below, so callers don't
// have to thread one through. Lazily created to avoid touching env at import
// time in edge/build contexts.
let wrapperClient: SupabaseClient | null = null;
function getWrapperClient(): SupabaseClient {
  if (!wrapperClient) {
    wrapperClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return wrapperClient;
}

type RouteHandler = (
  request: NextRequest,
  context: any,
) => Promise<Response> | Response;

/**
 * Wrap a route handler so any thrown error is recorded to `error_log` and then
 * turned into a 500 JSON response. Existing handlers that already try/catch and
 * return their own error responses keep working — this only catches escapes.
 *
 *   export const POST = withErrorLogging(async (req) => { ... });
 *
 * `actorId` extraction is best-effort: pass a resolver if the handler can
 * surface the acting user, otherwise the row is recorded without an actor.
 */
export function withErrorLogging(
  handler: RouteHandler,
  opts?: { area?: string; getActorId?: (request: NextRequest) => Promise<string | null> },
): RouteHandler {
  return async (request: NextRequest, context: any) => {
    try {
      return await handler(request, context);
    } catch (error) {
      const route = (() => {
        try {
          return new URL(request.url).pathname;
        } catch {
          return null;
        }
      })();
      let actorId: string | null = null;
      if (opts?.getActorId) {
        try {
          actorId = await opts.getActorId(request);
        } catch {
          /* non-fatal */
        }
      }
      await logErrorServer(getWrapperClient(), {
        area: opts?.area ?? areaFromRoute(route),
        route,
        method: request.method,
        status_code: 500,
        error,
        actor_id: actorId,
      });
      return NextResponse.json(
        { error: errorMessage(error) || "Internal server error" },
        { status: 500 },
      );
    }
  };
}
