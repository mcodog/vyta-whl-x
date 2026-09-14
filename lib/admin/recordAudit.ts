import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logAuditServer } from "./audit";

/**
 * Cross-module audit helper.
 *
 * `logAuditServer` (lib/admin/audit.ts) is the low-level writer: it needs a
 * service-role client and an already-resolved actor id. In practice every
 * route repeats the same boilerplate — build a service client, pull the bearer
 * token off the request, call `supabase.auth.getUser`, thread `userId` down to
 * the audit call. Routes that skip that boilerplate simply never log, which is
 * why some areas (e.g. backorders) had no audit trail at all.
 *
 * `recordAudit` collapses that into a single call: pass the request plus the
 * action/entity args and it resolves the actor and writes the row. Like
 * `logAuditServer`, it never throws — a failed audit write must not break the
 * mutation that triggered it.
 */

let sharedClient: SupabaseClient | null = null;

/** Lazily-constructed service-role client, reused across calls. */
function serviceClient(): SupabaseClient {
  if (!sharedClient) {
    sharedClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return sharedClient;
}

/**
 * Resolve the acting user's id from a request's `Authorization: Bearer` token.
 * Returns null when there is no token or it can't be verified — the audit row
 * is then attributed to "System" rather than lost.
 */
export async function resolveActorId(
  request: Request,
  client?: SupabaseClient,
): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { data: { user } } = await (client ?? serviceClient()).auth.getUser(token);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export interface RecordAuditArgs {
  /** Verb-suffixed action string, e.g. "backorder.delete". */
  action: string;
  /** Entity family for display grouping, e.g. "backorder". */
  entityType: string;
  /** Affected row id, when there is a single one. */
  entityId?: string | null;
  /** Arbitrary structured context stored alongside the entry. */
  payload?: Record<string, unknown> | null;
  /**
   * Request to resolve the actor from. Provide this when the caller hasn't
   * already looked up the user; the token's user id becomes the actor.
   */
  request?: Request;
  /**
   * Explicit actor id. Takes precedence over `request` — pass this when the
   * route already resolved the user, to avoid a second `getUser` round-trip.
   */
  actorId?: string | null;
  /**
   * Existing service-role client to reuse. Defaults to a shared internal one.
   */
  supabase?: SupabaseClient;
}

/**
 * Write a single audit-log entry. Resolves the actor from `actorId` when given,
 * otherwise from the request's bearer token. Swallows all errors.
 */
export async function recordAudit(args: RecordAuditArgs): Promise<void> {
  const db = args.supabase ?? serviceClient();
  const actorId =
    args.actorId !== undefined
      ? args.actorId
      : args.request
        ? await resolveActorId(args.request, db)
        : null;

  await logAuditServer(db, {
    actor_id: actorId,
    action: args.action,
    entity_type: args.entityType,
    entity_id: args.entityId ?? null,
    payload: args.payload ?? null,
  });
}
