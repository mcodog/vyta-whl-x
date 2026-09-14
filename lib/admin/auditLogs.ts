import { supabase } from "@/lib/supabase";

/**
 * Client-side fetchers + shared types for the admin Audit Logs interface.
 * Server writes live in lib/admin/audit.ts (logAuditServer); this file is
 * purely for reading the ledger from admin pages.
 */

export interface AuditActor {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string | null;
}

export interface AuditRecentAction {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
}

export interface AuditEntry extends AuditRecentAction {
  actor_id: string | null;
  payload: Record<string, unknown> | null;
  actor: AuditActor | null;
}

export interface AuditCard {
  actor: AuditActor;
  total_actions: number;
  today_actions: number;
  recent: AuditRecentAction[];
  last_active: string | null;
}

export interface AuditListParams {
  actorId?: string;
  action?: string;
  entity_type?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditListResult {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
}

/** Full display name for an actor, falling back to email then a short id. */
export function actorName(actor: AuditActor | null): string {
  if (!actor) return "System";
  const name = `${actor.first_name ?? ""} ${actor.last_name ?? ""}`.trim();
  return name || actor.email || `#${actor.id.slice(0, 8)}`;
}

/** Two-letter initials for an actor avatar. */
export function actorInitials(actor: AuditActor | null): string {
  if (!actor) return "SY";
  const f = actor.first_name?.[0] ?? "";
  const l = actor.last_name?.[0] ?? "";
  const initials = `${f}${l}`.trim();
  if (initials) return initials.toUpperCase();
  return (actor.email?.[0] ?? "?").toUpperCase();
}

export async function getAuditSummary(): Promise<AuditCard[]> {
  const res = await fetch("/api/admin/audit-logs?view=summary", {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load audit summary");
  const { cards } = await res.json();
  return cards ?? [];
}

export async function getAuditList(params: AuditListParams = {}): Promise<AuditListResult> {
  const qs = new URLSearchParams();
  if (params.actorId) qs.set("actorId", params.actorId);
  if (params.action) qs.set("action", params.action);
  if (params.entity_type) qs.set("entity_type", params.entity_type);
  if (params.search) qs.set("search", params.search);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  qs.set("page", String(params.page ?? 0));
  qs.set("pageSize", String(params.pageSize ?? 20));

  const res = await fetch(`/api/admin/audit-logs?${qs.toString()}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load audit logs");
  return res.json();
}
