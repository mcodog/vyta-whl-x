import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import { getSupabase } from '@/lib/supabase';
import {
  createEasyshipShipment,
  getShippingConfig,
  setEasyshipHandover,
} from '@/lib/shipping/easyship';
import { evaluateLabelReadiness } from '@/lib/shipping/labelReadiness';
import { recordAudit } from '@/lib/admin/recordAudit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/admin/orders/[id]/create-shipment
 * Creates an Easyship shipment for an order so a tracking number is generated
 * and tracking webhooks start flowing. Useful for email/invoice orders that
 * don't go through the crypto auto-confirm path.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = customer?.role || 'customer';
  if (!canAccessAdmin(role) || role === 'assistant') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const config = await getShippingConfig();
  if (!config.enabled || !config.apiKey) {
    return NextResponse.json(
      { error: 'Easyship is not enabled/configured in Settings' },
      { status: 400 },
    );
  }

  const db = getSupabase();
  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, email, items, shipping_address, easyship_shipment_id, notes')
    .eq('id', id)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  if (order.notes === 'PICKUP') {
    return NextResponse.json({ error: 'This is a local pickup order' }, { status: 400 });
  }
  if (order.easyship_shipment_id) {
    return NextResponse.json(
      { error: 'A shipment already exists for this order' },
      { status: 409 },
    );
  }

  // Don't buy a label for an incomplete address — refuse up front rather than
  // shipping a parcel that can't be delivered (and wasting the label spend).
  const readiness = evaluateLabelReadiness(order, config);
  if (!readiness.ready) {
    const failed = readiness.checks.filter((c) => !c.ok);
    return NextResponse.json(
      {
        error: `Not ready to ship — ${failed.map((c) => c.label).join(', ')}. Fix these before creating a shipment.`,
        code: 'not_ready',
        checks: failed,
      },
      { status: 422 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const courierId =
    typeof body?.courierId === 'string' && body.courierId.trim() ? body.courierId.trim() : null;
  const insured = body?.insured === true;
  const handover: 'pickup' | 'dropoff' | null =
    body?.handover === 'pickup' || body?.handover === 'dropoff' ? body.handover : null;

  const { shipment, error: shipmentError, httpStatus } = await createEasyshipShipment({
    order_number: order.order_number,
    email: order.email,
    shipping_address: order.shipping_address,
    items: Array.isArray(order.items) ? order.items : [],
    courierId,
    insured,
  });

  if (!shipment) {
    return NextResponse.json(
      {
        error: shipmentError
          ? `Easyship: ${shipmentError}`
          : 'Easyship did not return a shipment. Check the address and courier setup.',
        easyshipStatus: httpStatus ?? null,
      },
      { status: 502 },
    );
  }

  // Persist the shipment id, but only if the order is still unclaimed — this
  // conditional update is the race guard: if a concurrent request attached a
  // shipment between our earlier check and now, we claim nothing and know we
  // just created a duplicate at Easyship. Either way, never drop the shipment
  // id on the floor — surface it so ops can reconcile/void.
  const shipmentPatch = {
    easyship_shipment_id: shipment.shipmentId,
    tracking_number: shipment.trackingNumber || null,
    tracking_url: shipment.trackingUrl || null,
    carrier: shipment.courier || null,
  };
  const { data: claimed, error: updateError } = await db
    .from('orders')
    .update(shipmentPatch)
    .eq('id', order.id)
    .is('easyship_shipment_id', null)
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('create-shipment: failed to persist shipment', shipment.shipmentId, updateError);
    return NextResponse.json(
      {
        error: `Shipment ${shipment.shipmentId} was created at Easyship but could not be saved. Please reconcile it in Easyship.`,
        shipmentId: shipment.shipmentId,
      },
      { status: 500 },
    );
  }
  if (!claimed) {
    console.error('create-shipment: order already had a shipment; possible duplicate', shipment.shipmentId);
    return NextResponse.json(
      {
        error: `Another shipment was created for this order at the same time. Shipment ${shipment.shipmentId} is likely a duplicate — void it in Easyship.`,
        shipmentId: shipment.shipmentId,
        code: 'duplicate_shipment',
      },
      { status: 409 },
    );
  }

  // Apply the courier handover choice (pickup vs drop-off). Best-effort — the
  // shipment is already created/saved, so a handover hiccup doesn't fail it.
  if (handover) {
    const h = await setEasyshipHandover(shipment.shipmentId, handover);
    if (!h.ok) console.error('handover set failed for order', order.id, h.error);
  }

  await recordAudit({
    supabase,
    actorId: user.id,
    action: 'order.create_shipment',
    entityType: 'order',
    entityId: order.id,
    payload: {
      order_number: order.order_number,
      shipment_id: shipment.shipmentId,
      tracking_number: shipment.trackingNumber || null,
      courier: shipment.courier || null,
      handover: handover ?? null,
    },
  });

  return NextResponse.json({ success: true, shipment });
}
