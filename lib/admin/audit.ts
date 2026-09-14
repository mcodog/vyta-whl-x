import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntryInput {
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Append-only audit log writer. Failures are swallowed and logged — never
 * fail the originating mutation because we couldn't write the audit row.
 * Always called server-side with a service-role supabase client.
 */
export async function logAuditServer(
  supabase: SupabaseClient,
  entry: AuditEntryInput,
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_log").insert({
      actor_id: entry.actor_id,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      payload: entry.payload ?? null,
    });
    if (error) console.error("logAuditServer error:", error);
  } catch (e) {
    console.error("logAuditServer crashed:", e);
  }
}
