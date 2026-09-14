import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";
import { syncAffiliatePriceListFromOwnRecord } from "@/lib/admin/affiliate-pricelist-sync";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return { authorized: false, userId: null as string | null };
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authorized: false, userId: null };
    const { data: customer } = await supabase
      .from("customers")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = customer?.role || "customer";
    return { authorized: canCreate(role), userId: user.id };
  } catch {
    return { authorized: false, userId: null };
  }
}

// POST /api/admin/pricelists/[id]/apply-to-customer
// Body: { customer_id: string, mode?: 'override' | 'keep_existing' }
//   override      — the price list wins: every item price is written onto the
//                   customer's overrides (existing values replaced).
//   keep_existing — the customer's current overrides win: only products the
//                   customer has no override for are seeded from the list.
// Copies pricelist_items into customer_price_overrides and records the list on
// the customer (customers.applied_pricelist_id).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  const { id: pricelistId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const customerId = String(body?.customer_id ?? "").trim();
    const mode: "override" | "keep_existing" =
      body?.mode === "keep_existing" ? "keep_existing" : "override";
    if (!customerId) {
      return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
    }

    // Confirm both records exist.
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const { data: pricelist } = await supabase
      .from("pricelists")
      .select("id, name, currency")
      .eq("id", pricelistId)
      .maybeSingle();
    if (!pricelist) return NextResponse.json({ error: "Price list not found" }, { status: 404 });

    // The list's currency is authoritative for the numbers we're about to copy
    // into the customer's overrides. Prefer the stored column; fall back to
    // inferring USD from the list name (mirrors lib/admin/affiliate-pricing).
    const listCurrency: "CAD" | "USD" =
      pricelist.currency === "USD"
        ? "USD"
        : pricelist.currency === "CAD"
          ? "CAD"
          : typeof pricelist.name === "string" && /\busd\b/i.test(pricelist.name)
            ? "USD"
            : "CAD";

    const { data: items } = await supabase
      .from("pricelist_items")
      .select("product_id, price")
      .eq("pricelist_id", pricelistId);
    const listItems = items ?? [];

    // Existing overrides for this customer (used for keep_existing + reporting).
    const { data: existing } = await supabase
      .from("customer_price_overrides")
      .select("product_id")
      .eq("customer_id", customerId);
    const existingIds = new Set((existing ?? []).map((r: any) => r.product_id));

    const rowsToWrite = listItems
      .filter((i: any) => mode === "override" || !existingIds.has(i.product_id))
      .map((i: any) => ({
        customer_id: customerId,
        product_id: i.product_id,
        override_price: Math.max(0, Number(i.price) || 0),
      }));

    if (rowsToWrite.length > 0) {
      const { error: upsertErr } = await supabase
        .from("customer_price_overrides")
        .upsert(rowsToWrite, { onConflict: "customer_id,product_id" });
      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }
    }

    const skipped = listItems.length - rowsToWrite.length;

    // Pricing mode: 'override' rewrites every item from the list, so the
    // customer becomes a faithful copy of it → 'template'. 'keep_existing' that
    // kept ≥1 of the customer's own custom prices leaves them deviating from the
    // list → 'dedicated'. See lib/admin/pricing-mode.ts.
    const pricingMode: "template" | "dedicated" =
      mode === "keep_existing" && skipped > 0 ? "dedicated" : "template";

    // Remember which list drives this customer's prices, tag the customer with
    // the list's currency so downstream views (reports, invoices, price sheets)
    // label these numbers correctly instead of defaulting to CAD, and record
    // whether they now track the shared list ('template') or have kept bespoke
    // prices ('dedicated').
    await supabase
      .from("customers")
      .update({
        applied_pricelist_id: pricelistId,
        price_currency: listCurrency,
        pricing_mode: pricingMode,
      })
      .eq("id", customerId);

    // If this customer is an affiliate, keep their price list (applied to their
    // bound customers) in sync with the record we just priced (no-op otherwise).
    await syncAffiliatePriceListFromOwnRecord(supabase, customerId);

    await logAuditServer(supabase, {
      actor_id: userId,
      action: "pricelist.apply_to_customer",
      entity_type: "customer",
      entity_id: customerId,
      payload: {
        pricelist_id: pricelistId,
        pricelist_name: pricelist.name,
        mode,
        applied: rowsToWrite.length,
        skipped,
      },
    });

    return NextResponse.json({
      ok: true,
      applied: rowsToWrite.length,
      skipped,
      mode,
      pricelist: { id: pricelist.id, name: pricelist.name },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal server error" }, { status: 500 });
  }
}
