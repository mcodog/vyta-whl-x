import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import { getSupabase } from '@/lib/supabase';
import { recordAudit } from '@/lib/admin/recordAudit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * PATCH /api/admin/orders/[id]/shipping-address
 *
 * Updates the destination (shipping) address on an order so missing label
 * fields can be fixed inline before creating an Easyship shipment. Merges with
 * the existing address object and also syncs the order's contact email.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const body = await req.json().catch(() => ({}));

  const db = getSupabase();
  const { data: order, error } = await db
    .from('orders')
    .select('id, shipping_address, easyship_shipment_id')
    .eq('id', id)
    .single();
  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.easyship_shipment_id) {
    return NextResponse.json(
      { error: 'A shipment already exists — address can no longer be changed here.' },
      { status: 409 },
    );
  }

  const existing = (order.shipping_address || {}) as Record<string, any>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);

  // Only overwrite fields the client actually sent.
  const next = { ...existing };
  const fields = ['firstName', 'lastName', 'address', 'city', 'state', 'postalCode', 'country', 'phone', 'email'] as const;
  for (const f of fields) {
    const v = str(body[f]);
    if (v !== undefined) next[f] = v;
  }

  const update: Record<string, any> = {
    shipping_address: next,
    updated_at: new Date().toISOString(),
  };
  // Keep the order-level email in sync when an email is provided.
  const email = str(body.email);
  if (email) update.email = email;

  const { error: updErr } = await db.from('orders').update(update).eq('id', id);
  if (updErr) {
    return NextResponse.json({ error: 'Failed to update address' }, { status: 500 });
  }

  await recordAudit({
    supabase,
    actorId: user.id,
    action: 'order.address_update',
    entityType: 'order',
    entityId: id,
    payload: { fields: fields.filter((f) => str(body[f]) !== undefined) },
  });

  return NextResponse.json({ success: true, shipping_address: next });
}
