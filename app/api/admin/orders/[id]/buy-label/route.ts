import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import { getSupabase } from '@/lib/supabase';
import { buyEasyshipLabel, getEasyshipShipmentLabel } from '@/lib/shipping/easyship';
import { recordAudit } from '@/lib/admin/recordAudit';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/admin/orders/[id]/buy-label
 * Buys/confirms the Easyship label for the order's shipment. The PDF generates
 * asynchronously — the final URL also arrives via the shipment.label.created
 * webhook, so a pending result here is expected.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  const db = getSupabase();
  const { data: order, error } = await db
    .from('orders')
    .select('id, easyship_shipment_id, label_state')
    .eq('id', id)
    .single();
  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (!order.easyship_shipment_id) {
    return NextResponse.json({ error: 'No Easyship shipment for this order yet' }, { status: 400 });
  }

  const result = await buyEasyshipLabel(order.easyship_shipment_id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ? `Easyship: ${result.error}` : 'Failed to buy label' },
      { status: 502 },
    );
  }

  // The label PDF generates asynchronously — poll the shipment briefly to pick
  // up the document URL + tracking number once ready.
  let label = result.labelUrl ? result : { ...result };
  for (let i = 0; i < 4 && !label.labelUrl; i++) {
    await sleep(1500);
    const info = await getEasyshipShipmentLabel(order.easyship_shipment_id);
    label = { ...label, ...info };
    if (info.labelState === 'failed') break;
  }

  const updates: Record<string, unknown> = {
    label_state: label.labelState || 'pending',
  };
  if (label.labelUrl) updates.label_url = label.labelUrl;
  if (label.trackingNumber) updates.tracking_number = label.trackingNumber;
  await db.from('orders').update(updates).eq('id', order.id);

  await recordAudit({
    supabase,
    actorId: user.id,
    action: 'order.buy_label',
    entityType: 'order',
    entityId: order.id,
    payload: {
      shipment_id: order.easyship_shipment_id,
      label_state: label.labelState || 'pending',
      tracking_number: label.trackingNumber ?? null,
    },
  });

  return NextResponse.json({ success: true, ...label });
}
