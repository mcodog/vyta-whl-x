import { supabase } from "@/lib/supabase";
import type { AnalyticsSummary } from "@/lib/supabase";

export type { AnalyticsSummary } from "@/lib/supabase";

export interface AnalyticsRange {
  from?: string | null;
  to?: string | null;
}

export async function getAnalyticsSummary(
  range?: AnalyticsRange,
): Promise<AnalyticsSummary | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

    const params = new URLSearchParams();
    if (range?.from) params.set("from", range.from);
    if (range?.to) params.set("to", range.to);
    const qs = params.toString();

    const res = await fetch(`/api/admin/analytics/summary${qs ? `?${qs}` : ""}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("getAnalyticsSummary failed:", res.status);
      return null;
    }
    const { summary } = await res.json();
    return summary;
  } catch (e) {
    console.error("getAnalyticsSummary error:", e);
    return null;
  }
}
