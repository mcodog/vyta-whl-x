import type { SupabaseClient } from "@supabase/supabase-js";

/** Fields whose changes are tracked in product_change_history. */
export type ProductHistoryField = "price" | "price_usd" | "stock_quantity" | "vial_price";

/**
 * How a change was made. Mirrors the CHECK constraint in
 * product-price-stock-history-migration.sql.
 *   - create:  product was just created
 *   - inline:  inline cell edit on the Products table
 *   - form:    full edit form (Edit Product modal)
 *   - import:  CSV import
 *   - revert:  reverting to a previous value from the history view
 *   - api:     any other programmatic change
 *   - order:   stock decrement from a confirmed crypto order (written
 *              server-side by the adjust_stock_for_order DB function)
 *   - invoice: stock decrement from a fully paid invoice (written
 *              server-side by the adjust_stock_for_invoice DB function)
 *   - restock: stock increment from receiving a purchase order line item
 *              (written server-side by the receive_po_items DB function)
 *   - cell-grid: bulk price/stock edit saved from the Products cell-edit grid
 */
export type ProductChangeSource =
  | "create"
  | "inline"
  | "form"
  | "import"
  | "revert"
  | "api"
  | "order"
  | "invoice"
  | "restock"
  | "cell-grid";

const TRACKED_FIELDS: ProductHistoryField[] = ["price", "price_usd", "stock_quantity", "vial_price"];

/** Coerce a value to a finite number, or null if it isn't one. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface RecordProductChangesInput {
  productId: string;
  /** The customer who made the change, or null for system/unknown. */
  actorId: string | null;
  source: ProductChangeSource;
  /** Values before the change. Pass null/empty for a freshly created product. */
  before?: Partial<Record<ProductHistoryField, unknown>> | null;
  /** Values after the change. */
  after: Partial<Record<ProductHistoryField, unknown>>;
}

/**
 * Append history rows for any tracked field whose value actually changed.
 *
 * Best-effort: failures are logged but never thrown — recording history must
 * not fail the originating product mutation. Always called server-side with a
 * service-role supabase client.
 */
export async function recordProductChanges(
  supabase: SupabaseClient,
  input: RecordProductChangesInput,
): Promise<void> {
  try {
    const rows: Array<{
      product_id: string;
      field: ProductHistoryField;
      old_value: number | null;
      new_value: number;
      changed_by: string | null;
      change_source: ProductChangeSource;
    }> = [];

    for (const field of TRACKED_FIELDS) {
      if (!(field in input.after)) continue;
      const newValue = num(input.after[field]);
      if (newValue === null) continue;
      const oldValue = num(input.before?.[field]);
      // Skip no-op updates; always record the first ('create') row.
      if (oldValue !== null && oldValue === newValue) continue;

      rows.push({
        product_id: input.productId,
        field,
        old_value: oldValue,
        new_value: newValue,
        changed_by: input.actorId,
        change_source: input.source,
      });
    }

    if (rows.length === 0) return;

    const { error } = await supabase.from("product_change_history").insert(rows);
    if (error) console.error("recordProductChanges error:", error);
  } catch (e) {
    console.error("recordProductChanges crashed:", e);
  }
}
