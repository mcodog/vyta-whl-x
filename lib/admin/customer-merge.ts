import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fold one customer record's data into another, then delete the source.
 *
 * The identity model (ADR 0003) keys a person by a single auth UID shared across
 * `affiliates`, `customers` and `sales_persons`. A duplicate arises when the same
 * email lands on two different `customers` rows — an affiliate's own record and a
 * separate GUEST customer record. Merging re-points every customer-OWNED row from
 * `sourceId` onto `targetId`, back-fills any profile field the target is missing,
 * and removes the now-empty source row.
 *
 * Prefers the SQL `merge_customer_records` function (see
 * user-dedup-affiliate-customer-merge-migration.sql) so the runtime and the
 * backfill share one implementation; falls back to an in-app re-point if that
 * migration hasn't been applied yet.
 *
 * Actor columns (created_by / actor_id / …) are deliberately NOT re-pointed — a
 * guest duplicate never performed staff actions. The caller is responsible for
 * any Supabase Auth cleanup (guest sources have no auth user, so usually none).
 *
 * `supabase` must be a service-role client (the re-points bypass RLS).
 */
export async function mergeCustomerRecords(
  supabase: SupabaseClient,
  sourceId: string,
  targetId: string,
): Promise<void> {
  if (!sourceId || !targetId || sourceId === targetId) return;

  const { error } = await supabase.rpc('merge_customer_records', {
    p_source: sourceId,
    p_target: targetId,
  });
  if (!error) return;

  // The SQL function isn't deployed yet — merge in application code instead.
  console.warn(
    'merge_customer_records RPC unavailable, merging in app code:',
    error.message,
  );
  await mergeInApp(supabase, sourceId, targetId);
}

/** In-app fallback that mirrors the SQL merge_customer_records function. */
async function mergeInApp(
  supabase: SupabaseClient,
  sourceId: string,
  targetId: string,
): Promise<void> {
  const [{ data: target }, { data: source }] = await Promise.all([
    supabase.from('customers').select('*').eq('id', targetId).maybeSingle(),
    supabase.from('customers').select('*').eq('id', sourceId).maybeSingle(),
  ]);
  if (!target) throw new Error('Merge target does not exist');
  if (!source) return; // nothing to merge

  // Invoices & orders — no per-customer uniqueness, straight re-point.
  await supabase.from('invoices').update({ customer_id: targetId }).eq('customer_id', sourceId);
  await supabase.from('orders').update({ customer_id: targetId }).eq('customer_id', sourceId);

  // Customer price overrides — UNIQUE(customer_id, product_id): keep the target's
  // price for a product, move only the products it lacks, drop the rest.
  try {
    const [{ data: targetOverrides }, { data: sourceOverrides }] = await Promise.all([
      supabase.from('customer_price_overrides').select('product_id').eq('customer_id', targetId),
      supabase.from('customer_price_overrides').select('id, product_id').eq('customer_id', sourceId),
    ]);
    const targetProducts = new Set((targetOverrides ?? []).map((o: any) => String(o.product_id)));
    const moveIds = (sourceOverrides ?? [])
      .filter((o: any) => !targetProducts.has(String(o.product_id)))
      .map((o: any) => o.id);
    if (moveIds.length) {
      await supabase.from('customer_price_overrides').update({ customer_id: targetId }).in('id', moveIds);
    }
    await supabase.from('customer_price_overrides').delete().eq('customer_id', sourceId);
  } catch (e) {
    console.error('merge: customer_price_overrides re-point failed', e);
  }

  // Saved ship-to clients — straight re-point.
  try {
    await supabase.from('customer_clients').update({ customer_id: targetId }).eq('customer_id', sourceId);
  } catch (e) {
    console.error('merge: customer_clients re-point failed', e);
  }

  // Inactive-notification log — UNIQUE(customer_id, days_threshold).
  try {
    const [{ data: tRows }, { data: sRows }] = await Promise.all([
      supabase.from('customer_inactive_notifications').select('days_threshold').eq('customer_id', targetId),
      supabase.from('customer_inactive_notifications').select('id, days_threshold').eq('customer_id', sourceId),
    ]);
    const taken = new Set((tRows ?? []).map((r: any) => r.days_threshold));
    const moveIds = (sRows ?? []).filter((r: any) => !taken.has(r.days_threshold)).map((r: any) => r.id);
    if (moveIds.length) {
      await supabase.from('customer_inactive_notifications').update({ customer_id: targetId }).in('id', moveIds);
    }
    await supabase.from('customer_inactive_notifications').delete().eq('customer_id', sourceId);
  } catch (e) {
    console.error('merge: customer_inactive_notifications re-point failed', e);
  }

  // Cart snapshot — PRIMARY KEY(customer_id): keep the target's if present.
  try {
    const { data: targetCart } = await supabase
      .from('customer_carts')
      .select('customer_id')
      .eq('customer_id', targetId)
      .maybeSingle();
    if (targetCart) {
      await supabase.from('customer_carts').delete().eq('customer_id', sourceId);
    } else {
      await supabase.from('customer_carts').update({ customer_id: targetId }).eq('customer_id', sourceId);
    }
  } catch (e) {
    console.error('merge: customer_carts re-point failed', e);
  }

  // Affiliate applications — UNIQUE(customer_id) WHERE status='pending'.
  try {
    const { data: targetPending } = await supabase
      .from('affiliate_requests')
      .select('id')
      .eq('customer_id', targetId)
      .eq('status', 'pending')
      .maybeSingle();
    const { data: sourceReqs } = await supabase
      .from('affiliate_requests')
      .select('id, status')
      .eq('customer_id', sourceId);
    const moveIds = (sourceReqs ?? [])
      .filter((rq: any) => rq.status !== 'pending' || !targetPending)
      .map((rq: any) => rq.id);
    if (moveIds.length) {
      await supabase.from('affiliate_requests').update({ customer_id: targetId }).in('id', moveIds);
    }
    await supabase.from('affiliate_requests').delete().eq('customer_id', sourceId);
  } catch (e) {
    console.error('merge: affiliate_requests re-point failed', e);
  }

  // Stock waitlist — unique index is (product_id, email), not customer_id.
  try {
    await supabase.from('stock_notifications').update({ customer_id: targetId }).eq('customer_id', sourceId);
  } catch (e) {
    console.error('merge: stock_notifications re-point failed', e);
  }

  // Back-fill any profile field the target is missing, never overwriting the
  // target's own identity (name/email/role untouched).
  const fill: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const carryFields = [
    'phone',
    'alternate_email',
    'shipping_address',
    'shipping_city',
    'shipping_state',
    'shipping_postal_code',
    'shipping_country',
    'price_currency',
    'default_sales_person_id',
    'affiliate_id',
    'applied_pricelist_id',
  ] as const;
  for (const f of carryFields) {
    if ((target as any)[f] == null && (source as any)[f] != null) {
      fill[f] = (source as any)[f];
    }
  }
  await supabase.from('customers').update(fill).eq('id', targetId);

  // The source's data now lives on the target — remove the duplicate row.
  await supabase.from('customers').delete().eq('id', sourceId);
}
