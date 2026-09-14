import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import { getSupabase } from '@/lib/supabase';
import { getEasyshipRates, type ShippingRateItem } from '@/lib/shipping/easyship';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET /api/admin/orders/[id]/rates
 * Live courier options (FedEx/UPS, per the whitelist) for an order's
 * destination, so the admin can pick a courier before creating the shipment.
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
  if (!canAccessAdmin(customer?.role || 'customer')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const db = getSupabase();
  const { data: order, error } = await db
    .from('orders')
    .select('shipping_address, items')
    .eq('id', id)
    .single();
  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  const ship = (order.shipping_address || {}) as Record<string, any>;
  const destination = {
    address: ship.address ?? ship.line_1 ?? '',
    city: ship.city ?? '',
    state: ship.state ?? '',
    postalCode: ship.postalCode ?? ship.postal_code ?? '',
    country: ship.country ?? 'CA',
  };
  if (!destination.postalCode) {
    return NextResponse.json({ rates: [], error: 'Destination postal code missing' });
  }

  const items: ShippingRateItem[] = (Array.isArray(order.items) ? order.items : []).map(
    (it: any) => ({
      quantity: Number(it.quantity) || 1,
      declaredValue: Number(it.price) * (Number(it.quantity) || 1) || 0,
    }),
  );

  try {
    const rates = await getEasyshipRates(destination, items);
    return NextResponse.json({ rates });
  } catch (e) {
    return NextResponse.json(
      { rates: [], error: e instanceof Error ? e.message : 'Failed to load rates' },
      { status: 502 },
    );
  }
}
