import { supabase } from "@/lib/supabase";
import type { SupplierPriceRow, CheapestSupplierPrice } from "@/lib/supabase";

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }
    : { "Content-Type": "application/json" };
}

/** Every active product joined with this supplier's price (supplier_price null = uses default). */
export async function getSupplierPrices(supplierId: string): Promise<SupplierPriceRow[]> {
  const res = await fetch(`/api/admin/suppliers/${supplierId}/prices`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load supplier prices");
  }
  const { prices } = await res.json();
  return (prices ?? []) as SupplierPriceRow[];
}

/** Upsert a batch of { product_id, price } rows for a supplier. */
export async function saveSupplierPrices(
  supplierId: string,
  items: Array<{ product_id: string; price: number }>,
): Promise<void> {
  if (items.length === 0) return;
  const res = await fetch(`/api/admin/suppliers/${supplierId}/prices`, {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save supplier prices");
  }
}

/** Cheapest supplier per product, keyed by product_id. */
export async function getCheapestSupplierPrices(): Promise<Record<string, CheapestSupplierPrice>> {
  const res = await fetch(`/api/admin/supplier-prices/cheapest`, {
    headers: await authHeaders(),
  });
  if (!res.ok) return {};
  const { cheapest } = await res.json();
  return (cheapest ?? {}) as Record<string, CheapestSupplierPrice>;
}
