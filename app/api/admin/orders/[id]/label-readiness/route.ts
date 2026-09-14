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

/**
 * GET /api/admin/orders/[id]/label-readiness
 *
 * Returns a checklist of everything Easyship needs before a shipment/label can
 * be created for this order, plus a snapshot of the editable destination so the
 * admin can fix missing fields inline. `ready` is true only when every required
 * check passes.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  if (!canAccessAdmin(role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const db = getSupabase();
  const { data: order, error } = await db
    .from('orders')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  const config = await getShippingConfig();
  const { isPickup, ready, checks, destination } = evaluateLabelReadiness(order, config);

  // Suggested destination from the linked customer (for "smart fill"). Null for
  // guest orders — there's no customer record to pull from.
  let suggested: Record<string, string> | null = null;
  if (order.customer_id) {
    const { data: c } = await db
      .from('customers')
      .select(
        'first_name, last_name, email, phone, shipping_address, shipping_city, shipping_state, shipping_postal_code, shipping_country',
      )
      .eq('id', order.customer_id)
      .maybeSingle();
    if (c) {
      suggested = {
        firstName: c.first_name ?? '',
        lastName: c.last_name ?? '',
        address: c.shipping_address ?? '',
        city: c.shipping_city ?? '',
        state: c.shipping_state ?? '',
        postalCode: c.shipping_postal_code ?? '',
        country: c.shipping_country ?? 'CA',
        phone: c.phone ?? '',
        email: c.email ?? order.email ?? '',
      };
    }
  }

  return NextResponse.json({
    isPickup,
    ready,
    checks,
    destination,
    suggested,
    shipment: {
      hasShipment: Boolean(order.easyship_shipment_id),
      shipmentId: order.easyship_shipment_id ?? null,
      labelState: order.label_state ?? null,
      trackingNumber: order.tracking_number ?? null,
      carrier: order.carrier ?? null,
      trackingStatus: order.tracking_status ?? null,
    },
  });
}
