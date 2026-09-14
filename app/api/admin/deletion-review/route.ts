import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/admin/audit";
import { gatherReview, executeDeletion } from "@/lib/admin/deletion-execute";
import type { DeletionKind, DeletionPlan } from "@/lib/admin/deletion";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const KINDS: DeletionKind[] = ["customer", "sales_person", "user", "affiliate"];

// Deletion is admin-only (canDelete === 'admin'). Both the review and the
// execution require it, so no one can even enumerate a person's records here
// without delete rights.
async function verifyAdmin(
  request: NextRequest,
): Promise<{ authorized: boolean; userId: string | null }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { authorized: false, userId: null };
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return { authorized: false, userId: null };

  let { data: rows } = await supabase.from("customers").select("role").eq("id", user.id);
  if (!rows?.length && user.email) {
    const { data: emailRows } = await supabase
      .from("customers")
      .select("role")
      .eq("email", user.email.toLowerCase());
    rows = emailRows;
  }
  return { authorized: rows?.[0]?.role === "admin", userId: user.id };
}

function parseKind(value: string | null): DeletionKind | null {
  return value && (KINDS as string[]).includes(value) ? (value as DeletionKind) : null;
}

/**
 * GET /api/admin/deletion-review?kind=customer|sales_person|user&id=<uuid>
 * Returns the normalized "what will be affected" payload for the delete modal.
 */
export async function GET(request: NextRequest) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const kind = parseKind(searchParams.get("kind"));
  const id = searchParams.get("id");
  if (!kind || !id) {
    return NextResponse.json({ error: "kind and id are required" }, { status: 400 });
  }

  try {
    const review = await gatherReview(supabase, kind, id);
    if (!review) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json({ review });
  } catch (e) {
    console.error("deletion-review GET error", e);
    return NextResponse.json({ error: "Failed to load deletion review" }, { status: 500 });
  }
}

/**
 * POST /api/admin/deletion-review
 * Body: { kind, id, plan }. Applies the plan (snapshot + guest reassignment)
 * and removes the record.
 */
export async function POST(request: NextRequest) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const kind = parseKind(body?.kind ?? null);
  const id: string | undefined = body?.id;
  const plan: DeletionPlan | undefined = body?.plan;
  if (!kind || !id || !plan || typeof plan !== "object") {
    return NextResponse.json({ error: "kind, id and plan are required" }, { status: 400 });
  }

  // Normalize the plan defensively — never trust the client to send valid enums.
  const safePlan: DeletionPlan = {
    snapshot: plan.snapshot !== false,
    invoices: plan.invoices === "detach" ? "detach" : "reassign",
    orders: plan.orders === "detach" ? "detach" : "reassign",
    clients: plan.clients === "reassign" ? "reassign" : "delete",
    guestName: typeof plan.guestName === "string" && plan.guestName.trim()
      ? plan.guestName.trim().slice(0, 120)
      : null,
  };

  try {
    const outcome = await executeDeletion(supabase, kind, id, safePlan, userId);
    await logAuditServer(supabase, {
      actor_id: userId,
      action: `${kind}.delete`,
      entity_type: kind,
      entity_id: id,
      payload: {
        plan: safePlan,
        snapshot_id: outcome.snapshotId,
        guest_customer_id: outcome.guestId,
        via: "review_flow",
      },
    });
    return NextResponse.json({
      success: true,
      snapshotId: outcome.snapshotId,
      guestId: outcome.guestId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete record";
    console.error("deletion-review POST error", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
