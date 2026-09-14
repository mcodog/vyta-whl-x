import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import { getSupabase } from '@/lib/supabase';
import { getShippingConfig } from '@/lib/shipping/easyship';
import { evaluateLabelReadiness } from '@/lib/shipping/labelReadiness';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface BulkShipmentReadinessRow {
  id: string;
  orderNumber: string | null;
  /** True when a shipment can be created for this order right now. */
  eligible: boolean;
  isPickup: boolean;
  hasShipment: boolean;
  /** Why the order was skipped (present only when not eligible). */
  reason?: string;
}

/**
 * POST /api/admin/orders/bulk-shipment-readiness
 * Body: { ids: string[] }
 *
 * Pre-flight for the bulk "create shipment record" action. Evaluates each
 * selected order against the Easyship readiness checklist (loading the shipping
 * config once, not per order) and reports which orders can have a shipment
 * created and which will be skipped and why — so the confirmation dialog can
 * warn before anything is created.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = customer?.role || 'customer';
  if (!canAccessAdmin(role) || role === 'assistant') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No order ids provided' }, { status: 400 });
  }

  const config = await getShippingConfig();

  const db = getSupabase();
  const { data: orders, error } = await db
    .from('orders')
    .select('id, order_number, email, items, shipping_address, notes, fulfillment_type, easyship_shipment_id')
    .in('id', ids);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byId = new Map((orders ?? []).map((o: any) => [o.id, o]));

  // Preserve the caller's selection order, and account for any id that didn't
  // resolve to an order (deleted underneath us).
  const results: BulkShipmentReadinessRow[] = ids.map((id) => {
    const order = byId.get(id);
    if (!order) {
      return {
        id,
        orderNumber: null,
        eligible: false,
        isPickup: false,
        hasShipment: false,
        reason: 'Order not found',
      };
    }

    const hasShipment = Boolean(order.easyship_shipment_id);
    const { isPickup, ready, checks } = evaluateLabelReadiness(order, config);

    let reason: string | undefined;
    if (hasShipment) reason = 'A shipment already exists';
    else if (isPickup) reason = 'Local pickup order — no shipment needed';
    else if (!ready) {
      const failing = checks.filter((c) => !c.ok).map((c) => c.label);
      reason = `Missing: ${failing.join(', ')}`;
    }

    return {
      id,
      orderNumber: order.order_number ?? null,
      eligible: !hasShipment && !isPickup && ready,
      isPickup,
      hasShipment,
      reason,
    };
  });

  return NextResponse.json({ results });
}
