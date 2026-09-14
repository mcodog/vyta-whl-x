import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";
import { syncAffiliatePriceListFromOwnRecord } from "@/lib/admin/affiliate-pricelist-sync";
import {
  transformPrice,
  resultCurrency,
  isTransformed,
  normalizeMultiplier,
  normalizeRate,
  normalizeRoundTo,
  normalizeRoundDir,
  normalizeVialBasis,
  vialBasisValue,
  type ResultCurrency,
  type TransformOptions,
  type VialBasis,
} from "@/lib/pricing-transform";

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

// Resolve a price list's currency the same way the rest of the app does: the
// stored column wins, else infer USD from a "USD …" name (mirrors
// lib/admin/pricelists.ts / lib/admin/affiliate-pricing.ts).
function pricelistCurrency(pl: { currency?: string | null; name?: string | null } | null): ResultCurrency {
  if (pl?.currency === "USD") return "USD";
  if (pl?.currency === "CAD") return "CAD";
  if (typeof pl?.name === "string" && /\busd\b/i.test(pl.name)) return "USD";
  return "CAD";
}

// POST /api/admin/pricing/apply-transformed
// Body:
//   {
//     target_customer_id: string,
//     source_type: 'pricelist' | 'customer',
//     source_id: string,
//     multiplier_pct?: number,      // 100 = unchanged (default)
//     convert_to_usd?: boolean,     // CAD → USD; ignored unless source is CAD
//     cad_per_usd?: number,         // divisor for the conversion (default 1.45)
//     round_to?: 0 | 5 | 10 | 9,    // snap prices; 0 = off (default)
//     round_dir?: 'up' | 'down',    // round higher (default) or lower
//     vial_basis?: 'catalog_vial' | 'box_div_10' | 'retail' | 'source_vial',
//                                   // how the per-vial override is derived
//     vial_multiplier_pct?: number, // vial's own multiplier (100 = unchanged)
//     vial_round_to?: 0 | 5 | 10 | 9,   // vial's own rounding; 0 = off (default)
//     vial_round_dir?: 'up' | 'down',   // vial rounding direction
//     mode?: 'override' | 'keep_existing',
//   }
//
// Reads the source prices (a price list's items, or a customer's own custom
// prices), applies the multiplier and optional CAD→USD conversion, and writes
// the resulting BOX + per-VIAL prices onto the target customer's overrides. A
// price list holds box prices only, so the vial override is derived from the
// chosen `vial_basis` (catalog vial / box ÷ 10 / retail / the source customer's
// own vial). Box and vial each carry their own multiplier + rounding; the CAD→USD
// convert is shared. Records the target's currency + pricing_mode, and keeps an
// affiliate's mirror list in sync. This is the multiplier/convert superset of
// apply-to-customer.
export async function POST(request: NextRequest) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const targetId = String(body?.target_customer_id ?? "").trim();
    const sourceType: "pricelist" | "customer" = body?.source_type === "customer" ? "customer" : "pricelist";
    const sourceId = String(body?.source_id ?? "").trim();
    const mode: "override" | "keep_existing" = body?.mode === "keep_existing" ? "keep_existing" : "override";

    const opts: TransformOptions = {
      multiplierPct: normalizeMultiplier(body?.multiplier_pct),
      convertToUsd: body?.convert_to_usd === true,
      cadPerUsd: normalizeRate(body?.cad_per_usd),
      roundTo: normalizeRoundTo(body?.round_to),
      roundDir: normalizeRoundDir(body?.round_dir),
    };
    // How the per-vial override is derived from the (box-only) source. A copy
    // from another customer defaults to that customer's own vial prices.
    const vialBasis: VialBasis = normalizeVialBasis(
      body?.vial_basis ?? (sourceType === "customer" ? "source_vial" : "catalog_vial"),
    );
    // Vials carry their OWN multiplier + rounding, independent of the box; the
    // CAD→USD convert is shared (a mixed-currency override makes no sense).
    const vialOpts: TransformOptions = {
      multiplierPct: normalizeMultiplier(body?.vial_multiplier_pct),
      convertToUsd: opts.convertToUsd,
      cadPerUsd: opts.cadPerUsd,
      roundTo: normalizeRoundTo(body?.vial_round_to),
      roundDir: normalizeRoundDir(body?.vial_round_dir),
    };

    if (!targetId) {
      return NextResponse.json({ error: "target_customer_id is required" }, { status: 400 });
    }
    if (!sourceId) {
      return NextResponse.json({ error: "source_id is required" }, { status: 400 });
    }
    if (sourceType === "customer" && sourceId === targetId) {
      return NextResponse.json({ error: "Source and target customer must differ" }, { status: 400 });
    }

    // Confirm the target exists.
    const { data: target } = await supabase
      .from("customers")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();
    if (!target) return NextResponse.json({ error: "Target customer not found" }, { status: 404 });

    // Load the source prices + the source currency. `vial` carries the source's
    // own per-vial price (only a customer source has one); it's used for the
    // `source_vial` basis.
    let sourceCurrency: ResultCurrency = "CAD";
    let sourceName = "";
    let sourceRows: Array<{ product_id: string; price: number; vial: number | null }> = [];

    if (sourceType === "pricelist") {
      const { data: pl } = await supabase
        .from("pricelists")
        .select("id, name, currency")
        .eq("id", sourceId)
        .maybeSingle();
      if (!pl) return NextResponse.json({ error: "Price list not found" }, { status: 404 });
      sourceCurrency = pricelistCurrency(pl);
      sourceName = pl.name ?? "price list";
      const { data: items } = await supabase
        .from("pricelist_items")
        .select("product_id, price")
        .eq("pricelist_id", sourceId);
      // Price lists hold box prices only — no source vial.
      sourceRows = (items ?? []).map((i: any) => ({
        product_id: i.product_id,
        price: Number(i.price) || 0,
        vial: null,
      }));
    } else {
      const { data: cust } = await supabase
        .from("customers")
        .select("id, first_name, last_name, email, price_currency")
        .eq("id", sourceId)
        .maybeSingle();
      if (!cust) return NextResponse.json({ error: "Source customer not found" }, { status: 404 });
      sourceCurrency = cust.price_currency === "USD" ? "USD" : "CAD";
      sourceName = [cust.first_name, cust.last_name].filter(Boolean).join(" ") || cust.email || "customer";
      const { data: ov } = await supabase
        .from("customer_price_overrides")
        .select("product_id, override_price, vial_override_price")
        .eq("customer_id", sourceId);
      // Only the source's explicit custom box prices are copied; each carries the
      // source's own vial override (if any) for the `source_vial` basis.
      sourceRows = (ov ?? [])
        .filter((o: any) => o.override_price != null)
        .map((o: any) => ({
          product_id: o.product_id,
          price: Number(o.override_price) || 0,
          vial: o.vial_override_price != null ? Number(o.vial_override_price) : null,
        }));
    }

    // Catalog price + vial_price for every source product — the basis for the
    // `catalog_vial` / `retail` vial derivations (and the box ÷ 10 fallback).
    const catalog = new Map<string, { price: number; vial_price: number | null }>();
    const sourceProductIds = sourceRows.map((r) => r.product_id);
    if (sourceProductIds.length > 0) {
      const { data: prods } = await supabase
        .from("products")
        .select("id, price, vial_price")
        .in("id", sourceProductIds);
      for (const p of prods ?? []) {
        catalog.set(p.id, {
          price: Number(p.price) || 0,
          vial_price: p.vial_price != null ? Number(p.vial_price) : null,
        });
      }
    }

    const outCurrency = resultCurrency(sourceCurrency, opts.convertToUsd);

    // Existing target overrides — used for keep_existing + reporting.
    const { data: existing } = await supabase
      .from("customer_price_overrides")
      .select("product_id")
      .eq("customer_id", targetId);
    const existingIds = new Set((existing ?? []).map((r: any) => r.product_id));

    const rowsToWrite = sourceRows
      .filter((r) => mode === "override" || !existingIds.has(r.product_id))
      .map((r) => {
        const prod = catalog.get(r.product_id);
        // Derive the vial from the chosen basis, then apply the vial's own
        // multiplier + rounding (independent of the box).
        const basisVal = vialBasisValue(vialBasis, {
          sourceBox: r.price,
          sourceVial: r.vial,
          catalogBox: prod?.price ?? r.price,
          catalogVial: prod?.vial_price ?? null,
        });
        return {
          customer_id: targetId,
          product_id: r.product_id,
          override_price: transformPrice(r.price, sourceCurrency, opts),
          vial_override_price:
            basisVal != null ? transformPrice(basisVal, sourceCurrency, vialOpts) : null,
        };
      });

    if (rowsToWrite.length > 0) {
      const { error: upsertErr } = await supabase
        .from("customer_price_overrides")
        .upsert(rowsToWrite, { onConflict: "customer_id,product_id" });
      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }
    }

    const skipped = sourceRows.length - rowsToWrite.length;
    const transformed = sourceType === "customer" || isTransformed(opts, sourceCurrency);

    // Pricing mode + applied-list bookkeeping:
    //   * An untransformed price-list copy (override mode, ×100, no convert) is a
    //     faithful copy of that list → 'template', and we record the list.
    //   * A kept-existing apply that skipped some of the customer's own prices,
    //     any multiplier/convert transform, or a copy from another customer, all
    //     leave the customer deviating from any shared list → 'dedicated', with
    //     no single list to point applied_pricelist_id at.
    const pricingMode: "template" | "dedicated" =
      !transformed && sourceType === "pricelist" && !(mode === "keep_existing" && skipped > 0)
        ? "template"
        : "dedicated";
    const appliedPricelistId = pricingMode === "template" ? sourceId : null;

    await supabase
      .from("customers")
      .update({
        applied_pricelist_id: appliedPricelistId,
        price_currency: outCurrency,
        pricing_mode: pricingMode,
      })
      .eq("id", targetId);

    // If the target is an affiliate, keep their mirror price list in sync.
    await syncAffiliatePriceListFromOwnRecord(supabase, targetId);

    await logAuditServer(supabase, {
      actor_id: userId,
      action: "pricelist.apply_transformed",
      entity_type: "customer",
      entity_id: targetId,
      payload: {
        source_type: sourceType,
        source_id: sourceId,
        source_name: sourceName,
        multiplier_pct: opts.multiplierPct,
        convert_to_usd: opts.convertToUsd && sourceCurrency === "CAD",
        cad_per_usd: opts.cadPerUsd,
        round_to: opts.roundTo,
        round_dir: opts.roundDir,
        vial_basis: vialBasis,
        vial_multiplier_pct: vialOpts.multiplierPct,
        vial_round_to: vialOpts.roundTo,
        vial_round_dir: vialOpts.roundDir,
        mode,
        applied: rowsToWrite.length,
        skipped,
        result_currency: outCurrency,
      },
    });

    return NextResponse.json({
      ok: true,
      applied: rowsToWrite.length,
      skipped,
      mode,
      result_currency: outCurrency,
      source: { type: sourceType, id: sourceId, name: sourceName },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal server error" }, { status: 500 });
  }
}
