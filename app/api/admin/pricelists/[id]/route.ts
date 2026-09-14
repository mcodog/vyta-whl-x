import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(request: NextRequest, requireMutation = false) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return { authorized: false, role: "customer" as const, userId: null };
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authorized: false, role: "customer" as const, userId: null };
    const { data: customer } = await supabase
      .from("customers")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = customer?.role || "customer";
    if (requireMutation && !canCreate(role)) {
      return { authorized: false, role, userId: user.id };
    }
    if (!requireMutation && (role === "admin" || role === "assistant")) {
      return { authorized: true, role, userId: user.id };
    }
    return { authorized: role === "admin", role, userId: user.id };
  } catch {
    return { authorized: false, role: "customer" as const, userId: null };
  }
}

async function loadPricelist(id: string) {
  const { data, error } = await supabase
    .from("pricelists")
    .select(`
      *,
      creator:customers!pricelists_created_by_fkey ( id, first_name, last_name, email ),
      items:pricelist_items (
        id, pricelist_id, product_id, price, unlabeled_price, created_at, updated_at,
        product:products ( id, name, slug, strength, price )
      )
    `)
    .eq("id", id)
    .single();
  if (error || !data) return null;
  // Sort items by product name for a stable UI.
  (data.items ?? []).sort((a: any, b: any) =>
    (a.product?.name ?? "").localeCompare(b.product?.name ?? ""),
  );
  return data;
}

// GET /api/admin/pricelists/[id] — pricelist with its items + product info.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;
  const pricelist = await loadPricelist(id);
  if (!pricelist) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ pricelist });
}

// PATCH /api/admin/pricelists/[id]
// Body may include: { name?, is_active?, items?: [{ product_id, price }] }
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { authorized, userId } = await verifyAdmin(request, true);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const body = await request.json();

    // 1. Header fields (name / active).
    const headerPatch: Record<string, any> = {};
    if (typeof body?.name === "string" && body.name.trim()) headerPatch.name = body.name.trim();
    if (typeof body?.description === "string") headerPatch.description = body.description.trim() || null;
    if (typeof body?.is_active === "boolean") headerPatch.is_active = body.is_active;

    // Activating: clear the current active one first (only one active allowed).
    if (headerPatch.is_active === true) {
      await supabase.from("pricelists").update({ is_active: false }).eq("is_active", true);
    }

    if (Object.keys(headerPatch).length > 0) {
      const { error } = await supabase.from("pricelists").update(headerPatch).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 2. Item price updates (upsert by pricelist_id + product_id).
    if (Array.isArray(body?.items) && body.items.length > 0) {
      const rows = body.items
        .filter((i: any) => i?.product_id != null && i?.price != null)
        .map((i: any) => ({
          pricelist_id: id,
          product_id: i.product_id,
          price: Math.max(0, Number(i.price) || 0),
        }));
      if (rows.length > 0) {
        const { error } = await supabase
          .from("pricelist_items")
          .upsert(rows, { onConflict: "pricelist_id,product_id" });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    await logAuditServer(supabase, {
      actor_id: userId,
      action: "pricelist.update",
      entity_type: "pricelist",
      entity_id: id,
      payload: {
        ...headerPatch,
        items_updated: Array.isArray(body?.items) ? body.items.length : 0,
      },
    });

    const pricelist = await loadPricelist(id);
    return NextResponse.json({ pricelist });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/admin/pricelists/[id] — removes the pricelist and its items.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { authorized, userId } = await verifyAdmin(request, true);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  const { id } = await params;
  const { error } = await supabase.from("pricelists").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "pricelist.delete",
    entity_type: "pricelist",
    entity_id: id,
    payload: null,
  });

  return NextResponse.json({ ok: true });
}
