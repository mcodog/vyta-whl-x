import type { SupabaseClient } from "@supabase/supabase-js";

export interface BackorderLineInput {
  product_id: string | null;
  description: string;
  qty: number;
  unit_price?: number;
}

/**
 * Delete any OPEN backorder(s) for an invoice (cascades to their items).
 * Already-fulfilled backorders are left untouched as history. Used both when
 * recomputing a backorder and when an admin overrides the shortfall entirely.
 */
export async function clearOpenInvoiceBackorder(
  db: SupabaseClient,
  invoiceId: string,
): Promise<void> {
  const { data: openExisting } = await db
    .from("backorders")
    .select("id")
    .eq("invoice_id", invoiceId)
    .eq("status", "open");
  for (const b of openExisting ?? []) {
    await db.from("backorders").delete().eq("id", b.id);
  }
}

/**
 * Recompute the OPEN backorder for an invoice from its current line items.
 *
 * A line is backordered when its quantity exceeds the product's current
 * `stock_quantity`. Any existing OPEN backorder for the invoice is replaced;
 * already-fulfilled backorders are left untouched as history. Best-effort —
 * callers should not fail the invoice operation if this throws.
 */
export async function syncInvoiceBackorder(
  db: SupabaseClient,
  invoiceId: string,
  lineItems: BackorderLineInput[],
): Promise<void> {
  // Clear any existing OPEN backorder for this invoice (cascades to items).
  await clearOpenInvoiceBackorder(db, invoiceId);

  const withProduct = lineItems.filter((li) => li.product_id);
  if (withProduct.length === 0) return;

  const ids = [...new Set(withProduct.map((li) => li.product_id as string))];
  const { data: products } = await db
    .from("products")
    .select("id, stock_quantity")
    .in("id", ids);
  const stock = new Map((products ?? []).map((p: any) => [p.id, Number(p.stock_quantity ?? 0)]));

  const items = withProduct
    .map((li) => {
      const available = stock.get(li.product_id as string) ?? 0;
      const qty = Number(li.qty);
      const backordered = qty - available;
      if (!Number.isFinite(qty) || backordered <= 0) return null;
      return {
        product_id: li.product_id,
        description: li.description || "Item",
        qty_ordered: qty,
        qty_available: available,
        qty_backordered: backordered,
        unit_price: Number(li.unit_price ?? 0),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (items.length === 0) return;

  const { data: bo, error } = await db
    .from("backorders")
    .insert({ invoice_id: invoiceId, status: "open" })
    .select("id")
    .single();
  if (error || !bo) {
    console.error("syncInvoiceBackorder: failed to create backorder", error);
    return;
  }

  const { error: itemsErr } = await db
    .from("backorder_items")
    .insert(items.map((i) => ({ ...i, backorder_id: bo.id })));
  if (itemsErr) console.error("syncInvoiceBackorder: failed to insert items", itemsErr);
}
