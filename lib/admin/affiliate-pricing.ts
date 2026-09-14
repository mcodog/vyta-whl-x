/**
 * Server-side enforcement of affiliate invoice pricing.
 *
 * Affiliates (a.k.a. clients / sales people) never set their own prices: every
 * line is priced from the price list an admin assigned them in admin/pricing.
 * The invoice form locks the Unit $ / Disc % fields for them, but the UI lock
 * is cosmetic — the API must not trust prices submitted by an affiliate. These
 * helpers re-derive each line's price from the authoritative sources, using the
 * SAME precedence the invoice form uses client-side:
 *
 *   affiliate's own customer_price_overrides  →  globally active price list  →
 *   product catalog default
 *
 * Discounts are forced to 0 (an affiliate's commission/discount is applied at
 * the order level, not typed per line). See ADR
 * docs/adr/0001-affiliate-invoice-pricing-locked-to-assigned-pricelist.md.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { round2, usdFromCad, cadFromUsd, DEFAULT_USD_RATE } from "@/lib/pricing";

type Currency = "CAD" | "USD";

interface Override {
  labeled: number | null;
  unlabeled: number | null;
  vial: number | null;
}

interface ProductPricing {
  price: number;
  price_usd: number | null;
  vial_price: number | null;
}

export interface AffiliatePricingContext {
  /** The affiliate's own pricing currency (USD-tagged customer, else CAD). */
  isUsd: boolean;
  /** CAD→USD multiplier from Site Settings. */
  usdRate: number;
  /** The affiliate's box-price overrides, in their own currency. */
  overrides: Record<string, Override>;
  /** Currency the globally active price list stores its prices in. */
  activeCurrency: Currency;
  activePrices: Record<string, number>;
  activeUnlabeled: Record<string, number>;
  /** Catalog pricing for the products referenced by the lines. */
  products: Record<string, ProductPricing>;
}

// Resolve a price list's currency. Prefers the stored `currency` column; when it
// hasn't been migrated yet, infers USD from the list name — mirrors the client
// helper in lib/admin/pricelists.ts so both sides price a "USD …" list the same.
function currencyOf(pl: { currency?: string | null; name?: string | null } | null): Currency {
  if (pl?.currency === "USD") return "USD";
  if (pl?.currency === "CAD") return "CAD";
  if (typeof pl?.name === "string" && /\busd\b/i.test(pl.name)) return "USD";
  return "CAD";
}

/**
 * Load everything needed to re-derive an affiliate's line prices, from the same
 * sources the invoice form reads client-side.
 */
export async function loadAffiliatePricingContext(
  supabase: SupabaseClient,
  affiliateUserId: string,
  productIds: string[],
): Promise<AffiliatePricingContext> {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));

  const [meRes, ovRes, activeRes, rateRes, prodRes] = await Promise.all([
    supabase.from("customers").select("price_currency").eq("id", affiliateUserId).maybeSingle(),
    supabase
      .from("customer_price_overrides")
      .select("product_id, override_price, unlabeled_override_price, vial_override_price")
      .eq("customer_id", affiliateUserId),
    supabase
      .from("pricelists")
      .select("*")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1),
    // Selecting a single column that may not exist yet (pre-migration) resolves
    // with an error rather than throwing, so `rateRes.data` just comes back null
    // and we fall back to the default rate below.
    supabase.from("site_settings").select("usd_exchange_rate").maybeSingle(),
    uniqueIds.length
      ? supabase.from("products").select("id, price, price_usd, vial_price").in("id", uniqueIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const isUsd = ((meRes.data as any)?.price_currency ?? "") === "USD";

  const overrides: Record<string, Override> = {};
  for (const o of (ovRes.data as any[]) ?? []) {
    // A $0 box price marks the product Hidden for the affiliate (matches the
    // invoice form's affiliate load), so treat it as no box override — box then
    // falls through to the active list / catalog default. A row with only a vial
    // price is still kept for its vial override.
    const boxPresent = o.override_price != null && Number(o.override_price) !== 0;
    const vialPresent = o.vial_override_price != null;
    if (!boxPresent && !vialPresent) continue;
    overrides[o.product_id] = {
      labeled: boxPresent ? Number(o.override_price) : null,
      unlabeled: o.unlabeled_override_price != null ? Number(o.unlabeled_override_price) : null,
      vial: vialPresent ? Number(o.vial_override_price) : null,
    };
  }

  const activeRow = ((activeRes.data as any[]) ?? [])[0] ?? null;
  const activeCurrency = currencyOf(activeRow);
  const activePrices: Record<string, number> = {};
  const activeUnlabeled: Record<string, number> = {};
  if (activeRow) {
    const { data: items } = await supabase
      .from("pricelist_items")
      .select("product_id, price, unlabeled_price")
      .eq("pricelist_id", activeRow.id);
    for (const i of (items as any[]) ?? []) {
      activePrices[i.product_id] = Number(i.price);
      if (i.unlabeled_price != null) activeUnlabeled[i.product_id] = Number(i.unlabeled_price);
    }
  }

  const rawRate = (rateRes.data as any)?.usd_exchange_rate;
  const usdRate = rawRate != null && Number(rawRate) > 0 ? Number(rawRate) : DEFAULT_USD_RATE;

  const products: Record<string, ProductPricing> = {};
  for (const p of (prodRes.data as any[]) ?? []) {
    products[p.id] = {
      price: Number(p.price),
      price_usd: p.price_usd != null ? Number(p.price_usd) : null,
      vial_price: p.vial_price != null ? Number(p.vial_price) : null,
    };
  }

  return { isUsd, usdRate, overrides, activeCurrency, activePrices, activeUnlabeled, products };
}

/**
 * The authoritative unit price for one affiliate line — mirrors the invoice
 * form's priceForType/priceForProduct precedence exactly.
 */
export function affiliateUnitPrice(
  ctx: AffiliatePricingContext,
  opts: {
    productId: string | null;
    priceType: "box" | "vial";
    invoiceCurrency: Currency;
    withLabels: boolean;
  },
): number {
  const { productId, priceType, invoiceCurrency: cur, withLabels } = opts;

  // Manual (non-product) lines can't be priced from a list; an affiliate may not
  // set a free-form price, so such a line is $0.
  if (!productId) return 0;
  const product = ctx.products[productId];

  if (priceType === "vial") {
    // Per-vial override wins (stored in the affiliate's own currency), mirroring
    // the box path; otherwise the catalog vial_price, else the box price / 10.
    const ov = ctx.overrides[productId];
    if (ov?.vial != null) {
      const native = ov.vial;
      if (ctx.isUsd) return cur === "USD" ? round2(native) : cadFromUsd(native, ctx.usdRate);
      return cur === "USD" ? usdFromCad(native, ctx.usdRate) : round2(native);
    }
    if (!product) return 0;
    const cad =
      product.vial_price != null && product.vial_price > 0 ? product.vial_price : product.price / 10;
    return cur === "USD" ? usdFromCad(cad, ctx.usdRate) : round2(cad);
  }

  // Box price: affiliate override → globally active price list → catalog default.
  const ov = ctx.overrides[productId];
  if (ov != null && ov.labeled != null) {
    const native = !withLabels && ov.unlabeled != null ? ov.unlabeled : ov.labeled;
    if (ctx.isUsd) return cur === "USD" ? round2(native) : cadFromUsd(native, ctx.usdRate);
    return cur === "USD" ? usdFromCad(native, ctx.usdRate) : round2(native);
  }

  const listed = ctx.activePrices[productId];
  if (listed != null) {
    const listedUnlabeled = ctx.activeUnlabeled[productId];
    const value = !withLabels && listedUnlabeled != null ? listedUnlabeled : listed;
    if (ctx.activeCurrency === "USD") return cur === "USD" ? round2(value) : cadFromUsd(value, ctx.usdRate);
    return cur === "USD" ? usdFromCad(value, ctx.usdRate) : round2(value);
  }

  if (!product) return 0;
  if (cur === "USD") return product.price_usd != null ? round2(product.price_usd) : usdFromCad(product.price, ctx.usdRate);
  return round2(product.price);
}

/** A line whose price this module can re-derive and rewrite. */
interface PricedLine {
  product_id: string | null;
  qty: number;
  price_type?: "box" | "vial";
  unit_price: number;
  discount_pct: number;
  line_total: number;
}

/**
 * Replace every line's `unit_price` with the price resolved from the affiliate's
 * assigned pricing and recompute `line_total`. The client-submitted price is
 * ignored (affiliates can't set prices), but their discount is kept — clamped to
 * a sane 0–100% so a negative discount can't inflate the line total. All other
 * fields are preserved, so this works for both the POST (`SplitLine`) and PATCH
 * (line-item row) shapes.
 */
export async function enforceAffiliateLinePrices<T extends PricedLine>(
  supabase: SupabaseClient,
  affiliateUserId: string,
  invoiceCurrency: Currency,
  withLabels: boolean,
  lines: T[],
): Promise<T[]> {
  const ctx = await loadAffiliatePricingContext(
    supabase,
    affiliateUserId,
    lines.map((l) => l.product_id ?? "").filter(Boolean),
  );
  return lines.map((l) => {
    const unit = affiliateUnitPrice(ctx, {
      productId: l.product_id,
      priceType: l.price_type === "vial" ? "vial" : "box",
      invoiceCurrency,
      withLabels,
    });
    const disc = clampDiscount(l.discount_pct);
    return {
      ...l,
      unit_price: unit,
      discount_pct: disc,
      line_total: round2(l.qty * unit * (1 - disc / 100)),
    };
  });
}

/** Clamp a discount percentage to [0, 100]; non-numbers become 0. */
export function clampDiscount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
