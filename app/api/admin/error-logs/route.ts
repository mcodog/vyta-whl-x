import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logErrorServer } from "@/lib/admin/errorLog";
import { recordAudit } from "@/lib/admin/recordAudit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ACTOR_SELECT =
  "actor:customers!error_log_actor_id_fkey(id, first_name, last_name, email, role)";

async function verifyCaller(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { role: "customer", userId: null as string | null };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { role: "customer", userId: null };
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return { role: customer?.role ?? "customer", userId: user.id };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfWeek(): Date {
  const d = startOfToday();
  // Monday-based week.
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

// GET /api/admin/error-logs
//   ?view=stats  -> dashboard aggregates
//   (default)    -> paginated list; params: area, resolved(true/false), search,
//                   fingerprint, page, pageSize
export async function GET(request: NextRequest) {
  const { role } = await verifyCaller(request);
  if (role !== "admin" && role !== "assistant") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);

  try {
    if (searchParams.get("view") === "stats") {
      return await statsResponse();
    }
    return await listResponse(searchParams);
  } catch (error) {
    await logErrorServer(supabase, {
      area: "error-logs",
      route: "/api/admin/error-logs",
      method: "GET",
      error,
    });
    return NextResponse.json({ error: "Failed to load error logs" }, { status: 500 });
  }
}

async function statsResponse() {
  const today = startOfToday().toISOString();
  const week = startOfWeek().toISOString();

  const [
    { count: totalCount },
    { count: todayCount },
    { count: weekCount },
    { count: unresolvedCount },
    { data: recent },
  ] = await Promise.all([
    supabase.from("error_log").select("id", { count: "exact", head: true }),
    supabase.from("error_log").select("id", { count: "exact", head: true }).gte("created_at", today),
    supabase.from("error_log").select("id", { count: "exact", head: true }).gte("created_at", week),
    supabase.from("error_log").select("id", { count: "exact", head: true }).eq("resolved", false),
    // Bounded recent window for grouping repeated errors + area breakdown.
    supabase
      .from("error_log")
      .select("area, message, fingerprint, resolved, created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const rows = recent ?? [];

  // Group by fingerprint for "repeated errors".
  const byFingerprint = new Map<
    string,
    { fingerprint: string; count: number; message: string; area: string; last_seen: string; unresolved: number }
  >();
  for (const r of rows) {
    const g = byFingerprint.get(r.fingerprint);
    if (g) {
      g.count += 1;
      if (!r.resolved) g.unresolved += 1;
      if (Date.parse(r.created_at) > Date.parse(g.last_seen)) g.last_seen = r.created_at;
    } else {
      byFingerprint.set(r.fingerprint, {
        fingerprint: r.fingerprint,
        count: 1,
        message: r.message,
        area: r.area,
        last_seen: r.created_at,
        unresolved: r.resolved ? 0 : 1,
      });
    }
  }
  const repeated = Array.from(byFingerprint.values())
    .filter((g) => g.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Group by area for "area with the most errors".
  const byArea = new Map<string, number>();
  for (const r of rows) byArea.set(r.area, (byArea.get(r.area) ?? 0) + 1);
  const areas = Array.from(byArea.entries())
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    total: totalCount ?? 0,
    today: todayCount ?? 0,
    week: weekCount ?? 0,
    unresolved: unresolvedCount ?? 0,
    resolved: (totalCount ?? 0) - (unresolvedCount ?? 0),
    repeated,
    areas,
    // Note the grouping window so the UI can be honest about scope.
    grouping_window: rows.length,
  });
}

async function listResponse(searchParams: URLSearchParams) {
  const area = searchParams.get("area");
  const resolved = searchParams.get("resolved");
  const fingerprint = searchParams.get("fingerprint");
  const search = searchParams.get("search")?.trim();
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10) || 0);
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20));

  let query = supabase
    .from("error_log")
    .select(
      `id, area, route, method, status_code, message, stack, fingerprint, resolved, resolved_at, created_at, ${ACTOR_SELECT}`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (area) query = query.eq("area", area);
  if (fingerprint) query = query.eq("fingerprint", fingerprint);
  if (resolved === "true") query = query.eq("resolved", true);
  if (resolved === "false") query = query.eq("resolved", false);
  if (search) {
    const term = `%${search}%`;
    query = query.or(`message.ilike.${term},route.ilike.${term},area.ilike.${term}`);
  }

  const fromIdx = page * pageSize;
  const { data, count, error } = await query.range(fromIdx, fromIdx + pageSize - 1);
  if (error) throw error;

  return NextResponse.json({
    entries: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  });
}

// PATCH /api/admin/error-logs — flag one row or a whole fingerprint group as
// resolved / unresolved. Body: { id?, fingerprint?, resolved: boolean }
export async function PATCH(request: NextRequest) {
  const { role, userId } = await verifyCaller(request);
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const resolved = Boolean(body?.resolved);
    const id = body?.id as string | undefined;
    const fingerprint = body?.fingerprint as string | undefined;
    if (!id && !fingerprint) {
      return NextResponse.json({ error: "id or fingerprint required" }, { status: 400 });
    }

    const patch = {
      resolved,
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? userId : null,
    };

    let query = supabase.from("error_log").update(patch);
    query = id ? query.eq("id", id) : query.eq("fingerprint", fingerprint!);
    const { data, error } = await query.select("id");
    if (error) throw error;

    await recordAudit({
      supabase,
      actorId: userId,
      action: resolved ? "error_log.resolve" : "error_log.reopen",
      entityType: "error_log",
      entityId: id ?? null,
      payload: { fingerprint: fingerprint ?? null, count: data?.length ?? 0 },
    });

    return NextResponse.json({ updated: data?.length ?? 0 });
  } catch (error) {
    await logErrorServer(supabase, {
      area: "error-logs",
      route: "/api/admin/error-logs",
      method: "PATCH",
      actor_id: userId,
      error,
    });
    return NextResponse.json({ error: "Failed to update error log" }, { status: 500 });
  }
}
