import type { SupabaseClient } from "@supabase/supabase-js";
import { sendLowStockAlert } from "@/lib/email-smtp";

/**
 * Re-evaluate low-stock alerts for the given products.
 *
 * For each product that defines a `low_stock_threshold`:
 *   - if stock has dropped to/below the threshold and we haven't alerted yet,
 *     email the admin notification list and set `low_stock_alerted = true`;
 *   - if stock has recovered above the threshold, clear `low_stock_alerted`
 *     so the next dip re-alerts.
 *
 * Best-effort: callers should not fail their operation if this throws. Emails
 * go to `site_settings.admin_emails`.
 */
export async function checkLowStockForProducts(
  db: SupabaseClient,
  productIds: string[],
): Promise<void> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return;

  const { data: products, error } = await db
    .from("products")
    .select("id, name, slug, strength, stock_quantity, low_stock_threshold, low_stock_alerted")
    .in("id", ids);
  if (error || !products) {
    if (error) console.error("low-stock: failed to load products", error);
    return;
  }

  // Resolve which products newly crossed below the threshold (need an alert)
  // and which recovered (need the flag cleared) before touching email/db.
  const toAlert = products.filter(
    (p: any) =>
      p.low_stock_threshold !== null &&
      p.low_stock_threshold !== undefined &&
      Number(p.stock_quantity ?? 0) <= Number(p.low_stock_threshold) &&
      !p.low_stock_alerted,
  );
  const toReset = products.filter(
    (p: any) =>
      p.low_stock_threshold !== null &&
      p.low_stock_threshold !== undefined &&
      Number(p.stock_quantity ?? 0) > Number(p.low_stock_threshold) &&
      p.low_stock_alerted,
  );

  if (toReset.length > 0) {
    await db
      .from("products")
      .update({ low_stock_alerted: false })
      .in("id", toReset.map((p: any) => p.id));
  }

  if (toAlert.length === 0) return;

  // Load the admin notification recipients once.
  const { data: settings } = await db
    .from("site_settings")
    .select("admin_emails")
    .single();
  const adminEmails: string[] = Array.isArray(settings?.admin_emails) ? settings!.admin_emails : [];

  // Flag as alerted first so concurrent stock changes don't double-send.
  await db
    .from("products")
    .update({ low_stock_alerted: true })
    .in("id", toAlert.map((p: any) => p.id));

  if (adminEmails.length === 0) {
    console.warn("low-stock: products below threshold but no admin_emails configured");
    return;
  }

  for (const p of toAlert) {
    await sendLowStockAlert({
      adminEmails,
      productName: p.name,
      currentStock: Number(p.stock_quantity ?? 0),
      threshold: Number(p.low_stock_threshold),
      productSlug: p.slug,
      strength: p.strength,
    });
  }
}
