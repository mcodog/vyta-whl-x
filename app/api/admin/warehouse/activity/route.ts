import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyStaff(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { authorized: false };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { authorized: false };
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = customer?.role;
  return { authorized: role === "admin" || role === "assistant" };
}

// Every audit action a warehouse account can produce while working the queue.
// The previous version only looked at fulfillment_update, so packing checklist
// edits, line fulfilment, photos, ready/undraft, queue changes, and customer
// emails were all invisible — leaving the activity feed and per-person
// "last active" empty even when staff were clearly working.
const WAREHOUSE_ACTIONS = [
  "invoice.fulfillment_update",
  "invoice.handling_checklist_update",
  "invoice.line_fulfill",
  "invoice.line_backorder",
  "invoice.packed_photo_add",
  "invoice.packed_photo_remove",
  "invoice.undraft",
  "invoice.queue_remove",
  "invoice.queue_restore",
  "fulfillment.email_sent",
] as const;

// Friendly label for each warehouse audit action (fulfillment_update is handled
// separately from its `to` step).
const ACTION_LABEL: Record<string, string> = {
  "invoice.handling_checklist_update": "Updated packing checklist",
  "invoice.line_fulfill": "Fulfilled items",
  "invoice.line_backorder": "Backordered items",
  "invoice.packed_photo_add": "Added packing photo",
  "invoice.packed_photo_remove": "Removed packing photo",
  "invoice.undraft": "Marked ready",
  "invoice.queue_remove": "Removed from queue",
  "invoice.queue_restore": "Restored to queue",
  "fulfillment.email_sent": "Sent customer email",
};

const STEP_LABEL: Record<string, string> = {
  packed: "Packed",
  shipped: "Shipped",
  picked_up: "Picked up",
  pending: "Reset to pending",
};

// GET /api/admin/warehouse/activity
// Warehouse accounts + per-person performance + a recent activity log, built
// from the append-only audit_log. Admin/assistant only.
export async function GET(request: NextRequest) {
  const { authorized } = await verifyStaff(request);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // 1. Warehouse accounts.
  const { data: accounts } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email, active, can_send_fulfillment_emails, created_at, last_login_at")
    .eq("role", "warehouse")
    .order("created_at", { ascending: false });

  // 2. All warehouse-relevant events (most recent first).
  const { data: events } = await supabase
    .from("audit_log")
    .select("action, actor_id, payload, entity_id, created_at")
    .in("action", WAREHOUSE_ACTIONS as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(500);

  const evs = events ?? [];

  // Resolve actor names (could include admins who advanced a status too).
  const actorIds = [...new Set(evs.map((e) => e.actor_id).filter(Boolean))] as string[];
  const actorMap = new Map<string, { name: string; role: string }>();
  if (actorIds.length > 0) {
    const { data: actors } = await supabase
      .from("customers")
      .select("id, first_name, last_name, role")
      .in("id", actorIds);
    for (const a of actors ?? []) {
      actorMap.set(a.id, {
        name: [a.first_name, a.last_name].filter(Boolean).join(" ") || "Unknown",
        role: a.role,
      });
    }
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // 3. Per-account performance.
  type Perf = {
    id: string;
    name: string;
    email: string | null;
    active: boolean;
    packed: number;
    shipped: number;
    picked_up: number;
    completed: number;
    completed_today: number;
    actions: number;
    last_active: string | null;
  };
  const perfMap = new Map<string, Perf>();
  for (const a of accounts ?? []) {
    perfMap.set(a.id, {
      id: a.id,
      name: [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email || "Unknown",
      email: a.email,
      active: a.active !== false,
      packed: 0,
      shipped: 0,
      picked_up: 0,
      completed: 0,
      completed_today: 0,
      actions: 0,
      last_active: null,
    });
  }
  for (const e of evs) {
    const p = e.actor_id ? perfMap.get(e.actor_id) : undefined;
    if (!p) continue; // only track warehouse accounts in the performance table
    // Every warehouse event counts toward total activity + "last active", so a
    // packer who's only done checklist/photo work still surfaces as active.
    p.actions += 1;
    if (!p.last_active || e.created_at > p.last_active) p.last_active = e.created_at;

    if (e.action === "invoice.fulfillment_update") {
      const to = (e.payload as any)?.to as string | undefined;
      if (to === "packed") p.packed += 1;
      else if (to === "shipped") p.shipped += 1;
      else if (to === "picked_up") p.picked_up += 1;
      if (to === "shipped" || to === "picked_up") {
        p.completed += 1;
        if (new Date(e.created_at) >= startOfToday) p.completed_today += 1;
      }
    }
  }

  // 4. Recent activity log (resolve invoice/order numbers for the latest slice).
  const recentSlice = evs.slice(0, 80);
  const entityIds = [...new Set(recentSlice.map((e) => e.entity_id).filter(Boolean))] as string[];
  const invMap = new Map<string, { invoice_number: string; order_number: string | null }>();
  if (entityIds.length > 0) {
    const { data: invs } = await supabase
      .from("invoices")
      .select("id, invoice_number, order:orders!order_id (order_number)")
      .in("id", entityIds);
    for (const inv of invs ?? []) {
      invMap.set(inv.id, {
        invoice_number: inv.invoice_number,
        order_number: (inv as any).order?.order_number ?? null,
      });
    }
  }

  const logs = recentSlice.map((e) => {
    const inv = e.entity_id ? invMap.get(e.entity_id) : undefined;
    const actor = e.actor_id ? actorMap.get(e.actor_id) : undefined;
    // Fulfillment transitions are labelled by their target step; everything
    // else uses its action label.
    let action: string;
    let to: string | null = null;
    if (e.action === "invoice.fulfillment_update") {
      to = ((e.payload as any)?.to as string | undefined) ?? null;
      action = to ? STEP_LABEL[to] ?? to : "Updated status";
    } else {
      action = ACTION_LABEL[e.action] ?? "Updated";
    }
    return {
      at: e.created_at,
      actor_name: actor?.name ?? "System",
      actor_role: actor?.role ?? null,
      action,
      to,
      invoice_number: inv?.invoice_number ?? null,
      order_number: inv?.order_number ?? null,
    };
  });

  // Rank by throughput, then by overall activity so packers who haven't shipped
  // yet still surface above idle accounts.
  const performance = [...perfMap.values()].sort(
    (a, b) => b.completed - a.completed || b.actions - a.actions,
  );

  return NextResponse.json({ accounts: accounts ?? [], performance, logs });
}
