import type { SupabaseClient } from "@supabase/supabase-js";

export interface SupplierOption {
  supplier_id: string;
  supplier_name: string;
  /** Supplier's price for this product (explicit row, else the catalog price). */
  price: number;
  lead_time_days: number | null;
  /** True when the supplier has an explicit supplier_prices row for the product. */
  is_explicit: boolean;
}

export interface ProductSupplierOptions {
  /** Cheapest supplier_id across the explicit supplier rows (null = none carry it). */
  cheapest_supplier_id: string | null;
  /** Fallback catalog price (products.price) for a manually chosen supplier. */
  default_price: number;
  options: SupplierOption[];
}

export interface SupplierLite {
  id: string;
  name: string;
  lead_time_days: number | null;
}

export interface SupplierOptionsResult {
  suppliers: SupplierLite[];
  products: Record<string, ProductSupplierOptions>;
}

/**
 * For a set of product ids, resolve which suppliers carry each product and at
 * what price (explicit supplier_prices row, else the catalog price), flag the
 * cheapest, and return the full supplier list so the caller can assign a
 * supplier even to products no one explicitly prices. Shared by the invoice-
 * scoped route and the by-ids route used from the invoice form.
 */
export async function getSupplierOptionsForProducts(
  supabase: SupabaseClient,
  productIds: string[],
): Promise<SupplierOptionsResult> {
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name, lead_time_days")
    .order("name");
  const supplierList = (suppliers ?? []) as SupplierLite[];

  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  const products: Record<string, ProductSupplierOptions> = {};
  if (uniqueIds.length === 0) return { suppliers: supplierList, products };

  const { data: prods } = await supabase
    .from("products")
    .select("id, price")
    .in("id", uniqueIds);
  const defaultPrice = new Map<string, number>();
  for (const p of prods ?? []) defaultPrice.set(p.id, Number(p.price ?? 0));

  const { data: priceRows } = await supabase
    .from("supplier_prices")
    .select("product_id, price, supplier:suppliers ( id, name, lead_time_days )")
    .in("product_id", uniqueIds);

  for (const pid of uniqueIds) {
    products[pid] = {
      cheapest_supplier_id: null,
      default_price: defaultPrice.get(pid) ?? 0,
      options: [],
    };
  }

  for (const row of (priceRows ?? []) as any[]) {
    const sup = row.supplier;
    if (!sup?.id) continue;
    const bucket = products[row.product_id];
    if (!bucket) continue;
    bucket.options.push({
      supplier_id: sup.id,
      supplier_name: sup.name,
      price: Number(row.price ?? 0),
      lead_time_days: sup.lead_time_days ?? null,
      is_explicit: true,
    });
  }

  for (const pid of uniqueIds) {
    const bucket = products[pid];
    bucket.options.sort((a, b) => a.price - b.price);
    bucket.cheapest_supplier_id = bucket.options[0]?.supplier_id ?? null;
  }

  return { suppliers: supplierList, products };
}
