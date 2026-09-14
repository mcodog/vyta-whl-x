/**
 * Keep an affiliate's TWO price lists in sync.
 *
 * An affiliate (a.k.a. client / sales person) has the same auth UID across the
 * customers, affiliates and sales_persons tables (see ADR 0003), and that UID is
 * the key of two separate price lists:
 *
 *   1. `customer_price_overrides` WHERE customer_id = <uid>
 *      — the affiliate's OWN record. This is what prices the line items on
 *        invoices the affiliate creates (see lib/admin/affiliate-pricing.ts and
 *        the affiliate load in components/admin/InvoiceForm.tsx).
 *
 *   2. `affiliate_price_overrides` WHERE affiliate_id = <uid>
 *      — the affiliate's price list, copied onto every customer bound to them
 *        (see affiliate-pricelist-migration.sql and applyAffiliatePricelist in
 *        app/api/admin/customers/route.ts).
 *
 * These are meant to describe the same prices but were written by different code
 * paths, so they could drift: an affiliate importing a price list only updated
 * (2) and their bound customers — never their own (1) — so their invoices kept
 * the old prices; and an admin setting the affiliate's prices via Customer
 * Pricing only updated (1), never (2). These helpers keep the two identical so it
 * no longer matters which one a caller reads.
 *
 * `affiliate_price_overrides` stores only the labeled BOX price, so that is the
 * field synced. Unlabeled / per-vial / visibility data lives only on the
 * customer_price_overrides side and has no counterpart to sync.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** A customer_price_overrides row, as read from the affiliate's own record. */
export interface OwnOverrideRow {
  product_id: string;
  override_price: number | null;
  is_visible?: boolean | null;
}

/**
 * The affiliate-list rows implied by an affiliate's own overrides: only a
 * positive box price on a visible product carries a sellable price to mirror.
 * Visibility-only rows, $0 "hidden" markers and vial-only rows (null box price)
 * contribute nothing. Pure so it can be unit-tested without a database.
 */
export function sellableAffiliateRows(
  ownRows: OwnOverrideRow[],
): Array<{ product_id: string; override_price: number }> {
  return ownRows
    .filter(
      (r) =>
        r.override_price != null &&
        Number(r.override_price) > 0 &&
        r.is_visible !== false,
    )
    .map((r) => ({ product_id: r.product_id, override_price: Number(r.override_price) }));
}

/** True when this UID is an affiliate account (it has an `affiliates` row). */
export async function isAffiliateAccount(
  supabase: SupabaseClient,
  id: string,
): Promise<boolean> {
  if (!id) return false;
  const { data } = await supabase
    .from("affiliates")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return !!data;
}

/**
 * Rewrite `affiliate_price_overrides` for <affiliateId> so it holds exactly the
 * box prices on that affiliate's own `customer_price_overrides` record. A no-op
 * for non-affiliate UIDs, so callers can pass any customer_id blindly.
 *
 * Best-effort: syncing a price list must never block the write that triggered it,
 * so any failure is logged and swallowed (mirrors applyAffiliatePricelist).
 */
export async function syncAffiliatePriceListFromOwnRecord(
  supabase: SupabaseClient,
  affiliateId: string,
): Promise<void> {
  try {
    if (!(await isAffiliateAccount(supabase, affiliateId))) return;

    const { data: ownRows, error: readErr } = await supabase
      .from("customer_price_overrides")
      .select("product_id, override_price, is_visible")
      .eq("customer_id", affiliateId);
    if (readErr) throw readErr;

    const desired = sellableAffiliateRows((ownRows as OwnOverrideRow[]) ?? []);
    const desiredIds = new Set(desired.map((r) => r.product_id));

    if (desired.length > 0) {
      const { error: upErr } = await supabase.from("affiliate_price_overrides").upsert(
        desired.map((r) => ({
          affiliate_id: affiliateId,
          product_id: r.product_id,
          override_price: r.override_price,
        })),
        { onConflict: "affiliate_id,product_id" },
      );
      if (upErr) throw upErr;
    }

    // Drop affiliate-list products that no longer carry a sellable box price on
    // the affiliate's own record, so the two lists stay identical.
    const { data: existing, error: exErr } = await supabase
      .from("affiliate_price_overrides")
      .select("product_id")
      .eq("affiliate_id", affiliateId);
    if (exErr) throw exErr;

    const stale = (existing ?? [])
      .map((r: { product_id: string }) => r.product_id)
      .filter((pid: string) => !desiredIds.has(pid));
    if (stale.length > 0) {
      const { error: delErr } = await supabase
        .from("affiliate_price_overrides")
        .delete()
        .eq("affiliate_id", affiliateId)
        .in("product_id", stale);
      if (delErr) throw delErr;
    }
  } catch (e) {
    console.error("Failed to sync affiliate price list from own record:", e);
  }
}
