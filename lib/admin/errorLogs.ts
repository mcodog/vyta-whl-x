import { supabase } from "@/lib/supabase";
import type { AuditActor } from "@/lib/admin/auditLogs";

/**
 * Client-side fetchers + shared types for the admin Error Logs dashboard.
 * Server writes live in lib/admin/errorLog.ts (logErrorServer).
 */

export interface ErrorEntry {
  id: string;
  area: string;
  route: string | null;
  method: string | null;
  status_code: number | null;
  message: string;
  stack: string | null;
  fingerprint: string;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
  actor: AuditActor | null;
}

export interface ErrorRepeatedGroup {
  fingerprint: string;
  count: number;
  message: string;
  area: string;
  last_seen: string;
  unresolved: number;
}

export interface ErrorAreaStat {
  area: string;
  count: number;
}

export interface ErrorStats {
  total: number;
  today: number;
  week: number;
  unresolved: number;
  resolved: number;
  repeated: ErrorRepeatedGroup[];
  areas: ErrorAreaStat[];
  grouping_window: number;
}

export interface ErrorListParams {
  area?: string;
  resolved?: "true" | "false";
  fingerprint?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ErrorListResult {
  entries: ErrorEntry[];
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

export async function getErrorStats(): Promise<ErrorStats> {
  const res = await fetch("/api/admin/error-logs?view=stats", {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load error stats");
  return res.json();
}

export async function getErrorList(params: ErrorListParams = {}): Promise<ErrorListResult> {
  const qs = new URLSearchParams();
  if (params.area) qs.set("area", params.area);
  if (params.resolved) qs.set("resolved", params.resolved);
  if (params.fingerprint) qs.set("fingerprint", params.fingerprint);
  if (params.search) qs.set("search", params.search);
  qs.set("page", String(params.page ?? 0));
  qs.set("pageSize", String(params.pageSize ?? 20));

  const res = await fetch(`/api/admin/error-logs?${qs.toString()}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load error logs");
  return res.json();
}

export async function setErrorResolved(
  target: { id?: string; fingerprint?: string },
  resolved: boolean,
): Promise<number> {
  const res = await fetch("/api/admin/error-logs", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ ...target, resolved }),
  });
  if (!res.ok) throw new Error("Failed to update error");
  const { updated } = await res.json();
  return updated ?? 0;
}
