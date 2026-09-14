import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Shared admin gate — mirrors /api/admin/invoices.
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

// GET /api/admin/pricelists — list pricelists with item counts.
export async function GET(request: NextRequest) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await supabase
    .from("pricelists")
    .select(
      "*, pricelist_items(count), creator:customers!pricelists_created_by_fkey(id, first_name, last_name, email)",
    )
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pricelists = (data ?? []).map((row: any) => ({
    ...row,
    item_count: row.pricelist_items?.[0]?.count ?? 0,
    pricelist_items: undefined,
  }));

  return NextResponse.json({ pricelists });
}

// POST /api/admin/pricelists — create a pricelist, seeding item prices.
// Body: { name: string, source_pricelist_id?: string }
// Without a source, items are seeded from the current products.price defaults.
export async function POST(request: NextRequest) {
  const { authorized, userId } = await verifyAdmin(request, true);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const name = String(body?.name ?? "").trim();
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const sourceId = body?.source_pricelist_id ?? null;
    if (!name) return NextResponse.json({ error: "Pricelist name is required" }, { status: 400 });

    const { data: pricelist, error: plErr } = await supabase
      .from("pricelists")
      .insert({ name, description: description || null, is_active: false, created_by: userId })
      .select()
      .single();
    if (plErr || !pricelist) {
      return NextResponse.json({ error: plErr?.message ?? "Insert failed" }, { status: 500 });
    }

    // Build seed rows: copy from a source pricelist, otherwise from product defaults.
    let seedRows: Array<{ product_id: string; price: number }> = [];
    if (sourceId) {
      const { data: srcItems } = await supabase
        .from("pricelist_items")
        .select("product_id, price")
        .eq("pricelist_id", sourceId);
      seedRows = (srcItems ?? []).map((i: any) => ({
        product_id: i.product_id,
        price: Number(i.price),
      }));
    } else {
      const { data: products } = await supabase
        .from("products")
        .select("id, price")
        .eq("active", true);
      seedRows = (products ?? []).map((p: any) => ({
        product_id: p.id,
        price: Number(p.price) || 0,
      }));
    }

    if (seedRows.length > 0) {
      const { error: itemsErr } = await supabase
        .from("pricelist_items")
        .insert(seedRows.map((r) => ({ ...r, pricelist_id: pricelist.id })));
      if (itemsErr) {
        await supabase.from("pricelists").delete().eq("id", pricelist.id);
        return NextResponse.json({ error: itemsErr.message }, { status: 500 });
      }
    }

    await logAuditServer(supabase, {
      actor_id: userId,
      action: "pricelist.create",
      entity_type: "pricelist",
      entity_id: pricelist.id,
      payload: { name, description: description || null, seeded_items: seedRows.length, source_pricelist_id: sourceId },
    });

    return NextResponse.json(
      { pricelist: { ...pricelist, item_count: seedRows.length } },
      { status: 201 },
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal server error" }, { status: 500 });
  }
}
