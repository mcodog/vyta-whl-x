import { supabase } from "@/lib/supabase";
import type {
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  PurchaseOrderTaxType,
  Supplier,
} from "@/lib/supabase";

// -------------------------------------------------------------------------
// Auth helper
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

// -------------------------------------------------------------------------
// Purchase Orders
// -------------------------------------------------------------------------
export type PurchaseOrderListItem = PurchaseOrder & {
  item_count: number;
};

export async function getPurchaseOrders(filters?: {
  status?: PurchaseOrderStatus | "all";
  supplier_id?: string;
  search?: string;
}): Promise<PurchaseOrderListItem[]> {
  let query = supabase
    .from("purchase_orders")
    .select(`
      *,
      supplier:suppliers ( id, name ),
      items:purchase_order_items ( id )
    `)
    .order("created_at", { ascending: false });

  if (filters?.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters?.supplier_id) {
    query = query.eq("supplier_id", filters.supplier_id);
  }

  const { data, error } = await query;
  if (error) {
    console.error("getPurchaseOrders error:", error);
    return [];
  }

  const rows = (data ?? []).map((row: any) => ({
    ...row,
    item_count: Array.isArray(row.items) ? row.items.length : 0,
  })) as PurchaseOrderListItem[];

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    return rows.filter(
      (po) =>
        po.po_number.toLowerCase().includes(q) ||
        (po.supplier?.name ?? "").toLowerCase().includes(q),
    );
  }
  return rows;
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(`
      *,
      supplier:suppliers (*),
      items:purchase_order_items (*, product:products ( vials_per_box ))
    `)
    .eq("id", id)
    .single();

  if (error) {
    console.error("getPurchaseOrder error:", error);
    return null;
  }

  // Receipts are optional: the receiving tables may not exist yet if the
  // receiving migration hasn't been run. Never let that break PO loading.
  const { data: receipts, error: receiptsError } = await supabase
    .from("purchase_order_receipts")
    .select(`*, items:purchase_order_receipt_items (*)`)
    .eq("purchase_order_id", id)
    .order("created_at", { ascending: false });

  if (receiptsError) {
    console.warn("getPurchaseOrder receipts unavailable:", receiptsError.message);
  }

  return { ...data, receipts: receipts ?? [] } as PurchaseOrder;
}

export interface PurchaseOrderInput {
  supplier_id: string;
  status?: PurchaseOrderStatus;
  tax_type?: PurchaseOrderTaxType;
  tax_value?: number;
  shipping_fee?: number;
  discount_type?: PurchaseOrderTaxType;
  discount_value?: number;
  order_date?: string | null;
  expected_date?: string | null;
  notes?: string | null;
  items: Array<
    Omit<
      PurchaseOrderItem,
      | "id"
      | "purchase_order_id"
      | "created_at"
      | "line_total"
      | "qty_received"
      // Landed cost is derived and stored server-side — clients never send it.
      | "landed_unit_cost"
      | "landed_line_total"
    > & {
      line_total?: number;
    }
  >;
  /** When set, fulfilling this backorder — the server flushes it on success. */
  backorder_id?: string | null;
}

export async function createPurchaseOrder(input: PurchaseOrderInput): Promise<PurchaseOrder> {
  const res = await fetch("/api/admin/purchase-orders", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create purchase order");
  }
  const { purchase_order } = await res.json();
  return purchase_order;
}

export interface PurchaseOrderPatch {
  status?: PurchaseOrderStatus;
  supplier_id?: string;
  tax_type?: PurchaseOrderTaxType;
  tax_value?: number;
  shipping_fee?: number;
  discount_type?: PurchaseOrderTaxType;
  discount_value?: number;
  order_date?: string | null;
  expected_date?: string | null;
  notes?: string | null;
  /**
   * Line items. Each may carry an existing `id`: when overriding the
   * receiving lock the server reconciles by id (updating rows in place) so
   * received history is preserved instead of being deleted and re-inserted.
   */
  items?: Array<PurchaseOrderInput["items"][number] & { id?: string | null }>;
  /**
   * Explicit admin opt-in to edit line items on a PO that already has received
   * stock. Without it the server rejects item edits once receiving has started.
   */
  override_receiving_lock?: boolean;
}

export async function updatePurchaseOrder(
  id: string,
  patch: PurchaseOrderPatch,
): Promise<PurchaseOrder> {
  const res = await fetch(`/api/admin/purchase-orders/${id}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update purchase order");
  }
  const { purchase_order } = await res.json();
  return purchase_order;
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  const res = await fetch(`/api/admin/purchase-orders/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete purchase order");
  }
}

export interface ReceiptItemInput {
  po_item_id: string;
  qty: number;
}

export async function receivePurchaseOrderItems(
  id: string,
  payload: { note?: string | null; items: ReceiptItemInput[] },
): Promise<PurchaseOrder> {
  const res = await fetch(`/api/admin/purchase-orders/${id}/receipts`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to record receipt");
  }
  const { purchase_order } = await res.json();
  return purchase_order;
}

// -------------------------------------------------------------------------
// Suppliers
// -------------------------------------------------------------------------
export async function getAllSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .order("name");
  if (error) {
    console.error("getAllSuppliers error:", error);
    return [];
  }
  return data ?? [];
}

export async function searchSuppliers(term: string): Promise<Supplier[]> {
  if (!term.trim()) return [];
  const like = `%${term.trim()}%`;
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .or(`name.ilike.${like},email.ilike.${like}`)
    .order("name")
    .limit(8);
  if (error) {
    console.error("searchSuppliers error:", error);
    return [];
  }
  return data ?? [];
}

export type SupplierInput = Omit<Supplier, "id" | "created_at" | "updated_at">;

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const res = await fetch("/api/admin/suppliers", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create supplier");
  }
  const { supplier } = await res.json();
  return supplier;
}

export async function updateSupplier(id: string, patch: Partial<SupplierInput>): Promise<Supplier> {
  const res = await fetch(`/api/admin/suppliers/${id}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update supplier");
  }
  const { supplier } = await res.json();
  return supplier;
}

export async function deleteSupplier(id: string): Promise<void> {
  const res = await fetch(`/api/admin/suppliers/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete supplier");
  }
}
