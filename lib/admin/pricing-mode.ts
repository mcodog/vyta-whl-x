/**
 * Customer pricing mode — "template" vs "dedicated".
 *
 * A customer's prices are either a faithful copy of a shared price list
 * ("template") or hand-managed and bespoke to them ("dedicated"). Rather than
 * diffing every override against the applied list on each read, we keep a stored
 * flag (`customers.pricing_mode`) that the write paths maintain O(1):
 *
 *   * Applying a shared price list (apply-to-customer, override mode) writes a
 *     faithful copy of that list → `template`.
 *   * Any manual price write — a single/bulk override edit, an override delete,
 *     or a CSV price import — deviates from any shared source → `dedicated`.
 *
 * These helpers are the single chokepoint for that flag. They are best-effort:
 * a mode update must never block the price write that triggered it, so failures
 * are logged and swallowed (mirrors lib/admin/affiliate-pricelist-sync.ts).
 *
 * See customer-pricing-mode-migration.sql for the column + one-time backfill.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type PricingMode = "template" | "dedicated";

/** Set a customer's pricing_mode. Best-effort; never throws. */
export async function setCustomerPricingMode(
  supabase: SupabaseClient,
  customerId: string,
  mode: PricingMode,
): Promise<void> {
  if (!customerId) return;
  try {
    const { error } = await supabase
      .from("customers")
      .update({ pricing_mode: mode })
      .eq("id", customerId);
    if (error) throw error;
  } catch (e) {
    console.error(`Failed to set pricing_mode='${mode}' for customer ${customerId}:`, e);
  }
}

/**
 * Mark a customer as `dedicated` — their prices are now hand-managed and no
 * longer a faithful copy of a shared list. Call after any manual price write
 * (override upsert/delete, CSV import). Best-effort; never throws.
 */
export async function markCustomerDedicated(
  supabase: SupabaseClient,
  customerId: string,
): Promise<void> {
  await setCustomerPricingMode(supabase, customerId, "dedicated");
}

/**
 * Mark a customer as `template` — their prices are a faithful copy of the shared
 * list just applied to them. Call after apply-to-customer replaces their prices
 * with a list. Best-effort; never throws.
 */
export async function markCustomerTemplate(
  supabase: SupabaseClient,
  customerId: string,
): Promise<void> {
  await setCustomerPricingMode(supabase, customerId, "template");
}
