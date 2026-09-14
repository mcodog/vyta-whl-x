import { supabase } from "@/lib/supabase";
import type { Pricelist } from "@/lib/supabase";

// -------------------------------------------------------------------------
// Auth helpers (same pattern as lib/admin/invoices.ts)
// -------------------------------------------------------------------------
async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      }
    : { "Content-Type": "application/json" };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// -------------------------------------------------------------------------
// Pricelists
// -------------------------------------------------------------------------
export async function getPricelists(): Promise<Pricelist[]> {
  const { pricelists } = await apiFetch<{ pricelists: Pricelist[] }>("/api/admin/pricelists");
  return pricelists;
}

export async function getPricelist(id: string): Promise<Pricelist | null> {
  try {
    const { pricelist } = await apiFetch<{ pricelist: Pricelist }>(`/api/admin/pricelists/${id}`);
    return pricelist;
  } catch {
    return null;
  }
}

export async function createPricelist(name: string, sourcePricelistId?: string): Promise<Pricelist> {
  const { pricelist } = await apiFetch<{ pricelist: Pricelist }>("/api/admin/pricelists", {
    method: "POST",
    body: JSON.stringify({ name, source_pricelist_id: sourcePricelistId ?? null }),
  });
  return pricelist;
}

export interface PricelistPatch {
  name?: string;
  is_active?: boolean;
  items?: Array<{ product_id: string; price: number }>;
}

export async function updatePricelist(id: string, patch: PricelistPatch): Promise<Pricelist> {
  const { pricelist } = await apiFetch<{ pricelist: Pricelist }>(`/api/admin/pricelists/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return pricelist;
}

export async function setActivePricelist(id: string): Promise<Pricelist> {
  return updatePricelist(id, { is_active: true });
}

export async function deletePricelist(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/admin/pricelists/${id}`, { method: "DELETE" });
}

// -------------------------------------------------------------------------
// Active pricelist lookup (consumed by the invoice form)
// -------------------------------------------------------------------------
export interface ActivePricelist {
  pricelist: { id: string; name: string; is_active: boolean; currency?: "CAD" | "USD" } | null;
  // The currency the prices below are stored in. A USD list is shown 1:1 on a
  // USD invoice (no exchange-rate conversion). Defaults to CAD.
  currency: "CAD" | "USD";
  // product_id -> labeled price
  prices: Record<string, number>;
  // product_id -> unlabeled (base) price, only for products that carry one.
  unlabeled: Record<string, number>;
}

// The "no price list" selection: prices come straight from the products table
// (products.price / price_usd). An empty price map makes priceForProduct fall
// through to the catalog default.
export const DEFAULT_PRICELIST_ID = "default";
export const EMPTY_PRICELIST: ActivePricelist = {
  pricelist: null,
  currency: "CAD",
  prices: {},
  unlabeled: {},
};

// Resolve a pricelist's currency. Prefers the stored `currency` column; when it
// hasn't been migrated yet (undefined), infers USD from the list name so a "USD
// …" list still prices 1:1 instead of being multiplied by the exchange rate.
function currencyOf(pl: { currency?: string | null; name?: string | null } | null): "CAD" | "USD" {
  if (pl?.currency === "USD") return "USD";
  if (pl?.currency === "CAD") return "CAD";
  if (typeof pl?.name === "string" && /\busd\b/i.test(pl.name)) return "USD";
  return "CAD";
}

export async function getActivePricelist(): Promise<ActivePricelist> {
  const { pricelist, items } = await apiFetch<{
    pricelist: { id: string; name: string; is_active: boolean; currency?: "CAD" | "USD" } | null;
    items: Array<{ product_id: string; price: number; unlabeled_price?: number | null }>;
  }>("/api/admin/pricelists/active");
  const prices: Record<string, number> = {};
  const unlabeled: Record<string, number> = {};
  for (const i of items) {
    prices[i.product_id] = Number(i.price);
    if (i.unlabeled_price != null) unlabeled[i.product_id] = Number(i.unlabeled_price);
  }
  return { pricelist, currency: currencyOf(pricelist), prices, unlabeled };
}

// Fetch a specific pricelist's prices in the same shape as getActivePricelist,
// so the invoice form can re-price lines from any chosen list (not just the
// active one). Pass DEFAULT_PRICELIST_ID for the catalog-default selection.
export async function getPricelistPrices(id: string): Promise<ActivePricelist> {
  if (!id || id === DEFAULT_PRICELIST_ID) return { ...EMPTY_PRICELIST };
  const { pricelist } = await apiFetch<{
    pricelist: {
      id: string;
      name: string;
      is_active: boolean;
      currency?: "CAD" | "USD";
      items?: Array<{ product_id: string; price: number; unlabeled_price?: number | null }>;
    };
  }>(`/api/admin/pricelists/${encodeURIComponent(id)}`);
  const prices: Record<string, number> = {};
  const unlabeled: Record<string, number> = {};
  for (const i of pricelist.items ?? []) {
    prices[i.product_id] = Number(i.price);
    if (i.unlabeled_price != null) unlabeled[i.product_id] = Number(i.unlabeled_price);
  }
  return {
    pricelist: { id: pricelist.id, name: pricelist.name, is_active: pricelist.is_active, currency: pricelist.currency },
    currency: currencyOf(pricelist),
    prices,
    unlabeled,
  };
}

// -------------------------------------------------------------------------
// Per-customer price overrides (a customer's applied price list)
// -------------------------------------------------------------------------
// A customer's effective prices live in customer_price_overrides — the rows a
// price list writes when it's applied to the customer (see admin/pricing →
// Customer Pricing). Returns product_id -> { labeled, unlabeled } box price in
// the CUSTOMER's own currency (USD for USD-tagged customers, else CAD), so
// callers can layer it over the global active pricelist / product defaults.
// `unlabeled` is null when the customer has no unlabeled price for that product
// (callers fall back to the labeled price).
export interface CustomerOverride {
  /** Labeled box (pack) price, or null when the customer has only a vial
   *  override (box lines then fall back to the price list / catalog default). */
  labeled: number | null;
  /** Unlabeled box price, or null when the customer has no unlabeled price. */
  unlabeled: number | null;
  /** Single-vial price, or null when the customer has no per-vial override
   *  (vial lines then fall back to the catalog vial_price / price ÷ 10). */
  vial: number | null;
}

export async function getCustomerPriceOverrides(
  customerId: string,
): Promise<Record<string, CustomerOverride>> {
  const { overrides } = await apiFetch<{
    overrides: Array<{
      product_id: string;
      override_price: number | null;
      unlabeled_override_price?: number | null;
      vial_override_price?: number | null;
    }>;
  }>(`/api/admin/price-overrides?customer_id=${encodeURIComponent(customerId)}`);
  const prices: Record<string, CustomerOverride> = {};
  for (const o of overrides ?? []) {
    // Visibility-only rows carry no custom price at all — skip them so they don't
    // surface as a $0 override. A row with only a vial price is kept (box then
    // falls back to the price list / catalog default).
    if (o.override_price == null && o.vial_override_price == null) continue;
    prices[o.product_id] = {
      labeled: o.override_price != null ? Number(o.override_price) : null,
      unlabeled: o.unlabeled_override_price != null ? Number(o.unlabeled_override_price) : null,
      vial: o.vial_override_price != null ? Number(o.vial_override_price) : null,
    };
  }
  return prices;
}
