import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logErrorServer } from "@/lib/admin/errorLog";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Roles whose actions are surfaced in the audit interface. Customers are the
// only role intentionally excluded (they never appear as audit actors anyway).
const ACTOR_ROLES = ["admin", "assistant", "affiliate", "warehouse"] as const;

const ACTOR_SELECT =
  "actor:customers!audit_log_actor_id_fkey(id, first_name, last_name, email, role)";

// Admin/assistant gate — read-only interface, both roles allowed.
async function verifyReader(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { authorized: false, userId: null as string | null };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { authorized: false, userId: null };
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = customer?.role ?? "customer";
  return { authorized: role === "admin" || role === "assistant", userId: user.id };
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// GET /api/admin/audit-logs
//   ?view=summary                    -> per-admin cards (today count, latest 3, totals)
//   (default list mode) query params:
//     actorId, action, entity_type, search, from, to, page (0-idx), pageSize
export async function GET(request: NextRequest) {
  const { authorized } = await verifyReader(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view");

  try {
    if (view === "summary") {
      return await summaryResponse();
    }
    return await listResponse(searchParams);
  } catch (error) {
    await logErrorServer(supabase, {
      area: "audit-logs",
      route: "/api/admin/audit-logs",
      method: "GET",
      error,
    });
    return NextResponse.json({ error: "Failed to load audit logs" }, { status: 500 });
  }
}

// ---- Per-admin summary (card view) -----------------------------------------
async function summaryResponse() {
  // The people who can appear as actors.
  const { data: actors } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email, role")
    .in("role", ACTOR_ROLES as unknown as string[]);

  const actorList = actors ?? [];

  // Per-actor exact totals + today counts + latest 3 actions, computed in
  // parallel. The number of admin-side users is small, so a handful of light
  // queries each is cheaper and more accurate than aggregating the whole log.
  const today = startOfToday();
  const cards = await Promise.all(
    actorList.map(async (actor) => {
      const [{ count: total }, { count: todayCount }, { data: recent }] = await Promise.all([
        supabase
          .from("audit_log")
          .select("id", { count: "exact", head: true })
          .eq("actor_id", actor.id),
        supabase
          .from("audit_log")
          .select("id", { count: "exact", head: true })
          .eq("actor_id", actor.id)
          .gte("created_at", today),
        supabase
          .from("audit_log")
          .select("id, action, entity_type, entity_id, created_at")
          .eq("actor_id", actor.id)
          .order("created_at", { ascending: false })
          .limit(3),
      ]);
      return {
        actor,
        total_actions: total ?? 0,
        today_actions: todayCount ?? 0,
        recent: recent ?? [],
        last_active: recent?.[0]?.created_at ?? null,
      };
    }),
  );

  // Sort: most active today first, then most-recently active, then by name.
  cards.sort((a, b) => {
    if (b.today_actions !== a.today_actions) return b.today_actions - a.today_actions;
    const at = a.last_active ? Date.parse(a.last_active) : 0;
    const bt = b.last_active ? Date.parse(b.last_active) : 0;
    if (bt !== at) return bt - at;
    return `${a.actor.first_name}`.localeCompare(`${b.actor.first_name}`);
  });

  return NextResponse.json({ cards });
}

// ---- Filtered, paginated list (table view) ---------------------------------
async function listResponse(searchParams: URLSearchParams) {
  const actorId = searchParams.get("actorId");
  const action = searchParams.get("action");
  const entityType = searchParams.get("entity_type");
  const search = searchParams.get("search")?.trim();
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10) || 0);
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20));

  let query = supabase
    .from("audit_log")
    .select(`id, actor_id, action, entity_type, entity_id, payload, created_at, ${ACTOR_SELECT}`, {
      count: "exact",
    })
    .order("created_at", { ascending: false });

  if (actorId) query = query.eq("actor_id", actorId);
  if (action) query = query.eq("action", action);
  if (entityType) query = query.eq("entity_type", entityType);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  if (search) {
    // Match on action/entity fields, and also on actor names/emails by
    // resolving matching actor ids first.
    const term = `%${search}%`;
    const { data: matchedActors } = await supabase
      .from("customers")
      .select("id")
      .or(`first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`);
    const actorIds = (matchedActors ?? []).map((a) => a.id);
    const orParts = [
      `action.ilike.${term}`,
      `entity_type.ilike.${term}`,
    ];
    if (actorIds.length > 0) {
      orParts.push(`actor_id.in.(${actorIds.join(",")})`);
    }
    query = query.or(orParts.join(","));
  }

  const fromIdx = page * pageSize;
  const toIdx = fromIdx + pageSize - 1;
  const { data, count, error } = await query.range(fromIdx, toIdx);
  if (error) throw error;

  return NextResponse.json({
    entries: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  });
}
