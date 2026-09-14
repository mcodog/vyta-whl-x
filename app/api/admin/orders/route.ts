import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canDelete, type UserRole } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getCaller(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  return { id: user.id, role: (customer?.role || 'customer') as string };
}

function shape(rows: any[]) {
  return rows.map((order: any) => ({
    ...order,
    customer_email: order.customers?.email,
    customer_name: order.customers
      ? `${order.customers.first_name} ${order.customers.last_name}`
      : null,
  }));
}

/**
 * GET /api/admin/orders — role-scoped order list.
 * admin/assistant: all orders. affiliate: orders for their bound customers only.
 */
export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller || caller.role === 'customer') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const select = `*, customers ( email, first_name, last_name )`;

  if (caller.role === 'affiliate') {
    // Resolve their bound customers first.
    const { data: bound } = await supabase
      .from('customers')
      .select('id')
      .eq('affiliate_id', caller.id);
    const ids = (bound ?? []).map((c) => c.id);
    if (ids.length === 0) return NextResponse.json({ orders: [] });

    const { data, error } = await supabase
      .from('orders')
      .select(select)
      .in('customer_id', ids)
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ orders: shape(data ?? []) });
  }

  const { data, error } = await supabase
    .from('orders')
    .select(select)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: shape(data ?? []) });
}

/**
 * DELETE /api/admin/orders — admin-only bulk delete.
 * Body: { ids: string[] }.
 *
 * Orders and invoices are a 1:1 pair (invoices.order_id → orders.id), so
 * deleting an order also deletes its linked invoice. That FK is ON DELETE SET
 * NULL, which would otherwise orphan the invoice, so we remove the invoices
 * first (their line items, payments and backorders cascade). Crypto payment
 * addresses (sol_addresses.order_id) have a RESTRICT FK, so we release them
 * before deleting. order_items and shipment logs cascade automatically.
 */
export async function DELETE(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller || !canDelete(caller.role as UserRole)) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No order ids provided' }, { status: 400 });
  }

  // Delete the invoices linked to these orders first (they'd otherwise be
  // orphaned by the SET NULL FK). Invoice children cascade.
  const { data: linkedInvoices } = await supabase
    .from('invoices')
    .select('id')
    .in('order_id', ids);
  const invoiceIds = (linkedInvoices ?? []).map((i: { id: string }) => i.id);
  if (invoiceIds.length > 0) {
    const { error: invErr } = await supabase.from('invoices').delete().in('id', invoiceIds);
    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  }

  // Release any crypto payment addresses pinned to these orders — that FK has
  // no cascade and would block the delete.
  await supabase.from('sol_addresses').update({ order_id: null }).in('order_id', ids);

  const { error } = await supabase.from('orders').delete().in('id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const id of ids) {
    await logAuditServer(supabase, {
      actor_id: caller.id,
      action: 'order.delete',
      entity_type: 'order',
      entity_id: id,
    });
  }

  return NextResponse.json({ ok: true, deleted: ids.length, invoicesDeleted: invoiceIds.length });
}
