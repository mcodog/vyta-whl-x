import { supabase } from "@/lib/supabase";
import type { PurchaseOrder } from "@/lib/supabase";

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }
    : { "Content-Type": "application/json" };
}

/** Convert an existing invoice into a prepaid one, auto-routing each line to the
 *  cheapest supplier. Returns how many lines were routed. */
export async function convertInvoiceToPrepaid(
  invoiceId: string,
): Promise<{ ok: boolean; lines_routed: number }> {
  const res = await fetch(`/api/admin/invoices/${invoiceId}/convert-to-prepaid`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Could not convert to prepaid");
  }
  return res.json();
}

export interface SupplierOption {
  supplier_id: string;
  supplier_name: string;
  price: number;
  lead_time_days: number | null;
  is_explicit: boolean;
}

export interface ProductSupplierOptions {
  cheapest_supplier_id: string | null;
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

/** Suppliers + prices for every product on the invoice (cheapest flagged). */
export async function getInvoiceSupplierOptions(invoiceId: string): Promise<SupplierOptionsResult> {
  const res = await fetch(`/api/admin/invoices/${invoiceId}/supplier-options`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load supplier options");
  }
  return res.json();
}

/** Suppliers + prices for an arbitrary set of products (used by the invoice
 *  form, before the invoice is saved). */
export async function getSupplierOptionsByProductIds(
  productIds: string[],
): Promise<SupplierOptionsResult> {
  if (productIds.length === 0) return { suppliers: [], products: {} };
  const res = await fetch(`/api/admin/supplier-options`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ product_ids: productIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load supplier options");
  }
  return res.json();
}

/** A purchase order linked to a prepaid invoice, with a lightweight item list. */
export interface LinkedPurchaseOrder extends PurchaseOrder {
  items?: Array<{
    id: string;
    description: string;
    sku_snapshot: string | null;
    qty: number;
    product_id: string | null;
  }>;
}

export async function getInvoicePurchaseOrders(invoiceId: string): Promise<LinkedPurchaseOrder[]> {
  const res = await fetch(`/api/admin/invoices/${invoiceId}/purchase-orders`, {
    headers: await authHeaders(),
  });
  if (!res.ok) return [];
  const { purchase_orders } = await res.json();
  return (purchase_orders ?? []) as LinkedPurchaseOrder[];
}

export interface CreatePoGroupItem {
  product_id: string | null;
  description: string;
  sku_snapshot: string | null;
  qty: number;
  unit_price: number;
  price_type: "box" | "vial";
}

export interface CreatePoGroup {
  supplier_id: string;
  notes?: string | null;
  expected_date?: string | null;
  items: CreatePoGroupItem[];
}

export interface CreatePoResult {
  purchase_orders: PurchaseOrder[];
  failures: Array<{ supplier_id: string | null; error: string }>;
}

/** Create one PO per supplier group, each linked to the prepaid invoice. */
export async function createInvoicePurchaseOrders(
  invoiceId: string,
  groups: CreatePoGroup[],
): Promise<CreatePoResult> {
  const res = await fetch(`/api/admin/invoices/${invoiceId}/purchase-orders`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ groups }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && (!data.purchase_orders || data.purchase_orders.length === 0)) {
    throw new Error(data.error || data.failures?.[0]?.error || "Failed to create purchase orders");
  }
  return { purchase_orders: data.purchase_orders ?? [], failures: data.failures ?? [] };
}
