import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface Caller {
  id: string;
  role: UserRole;
  name: string;
  email: string;
}

/** Resolve the authenticated caller (id, role, display name, email). */
async function getCaller(request: NextRequest): Promise<Caller | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: customer } = await supabase
    .from('customers')
    .select('role, first_name, last_name, email')
    .eq('id', user.id)
    .maybeSingle();
  const name =
    `${customer?.first_name ?? ''} ${customer?.last_name ?? ''}`.trim() ||
    customer?.email ||
    user.email ||
    'Admin';
  return {
    id: user.id,
    role: (customer?.role || 'customer') as UserRole,
    name,
    email: customer?.email || user.email || '',
  };
}

// GET — full contact/takeover view for one customer: profile, order summary,
// current cart snapshot, and who (if anyone) has taken them over.
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const caller = await getCaller(request);
  // Admins act; assistants may view (read-only). No affiliate/customer access —
  // the takeover view is not affiliate-scoped, so it stays admin-team only.
  if (!caller || (caller.role !== 'admin' && caller.role !== 'assistant')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const { id } = await ctx.params;

  const { data: customer, error } = await supabase
    .from('customers')
    .select(
      'id, first_name, last_name, email, phone, role, active, created_at, last_login_at, ' +
        'shipping_address, shipping_city, shipping_state, shipping_postal_code, shipping_country, ' +
        'affiliate_id, assigned_admin_id, assigned_admin_name, assigned_admin_email, assigned_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (error || !customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }

  // Orders for this customer (by id, and by email to catch guest-checkout rows).
  let orderQuery = supabase
    .from('orders')
    .select('id, order_number, status, total, created_at, items')
    .order('created_at', { ascending: false })
    .limit(50);
  if (customer.email) {
    orderQuery = orderQuery.or(`customer_id.eq.${id},email.eq.${customer.email}`);
  } else {
    orderQuery = orderQuery.eq('customer_id', id);
  }
  const { data: orders } = await orderQuery;

  // Current cart snapshot (populated by the store when the customer is online).
  const { data: cart } = await supabase
    .from('customer_carts')
    .select('items, item_count, updated_at')
    .eq('customer_id', id)
    .maybeSingle();

  // Referring affiliate (optional, for context).
  let referredBy: string | null = null;
  if (customer.affiliate_id) {
    const { data: aff } = await supabase
      .from('affiliates')
      .select('first_name, last_name, email')
      .eq('id', customer.affiliate_id)
      .maybeSingle();
    if (aff) {
      referredBy =
        `${aff.first_name ?? ''} ${aff.last_name ?? ''}`.trim() || aff.email || null;
    }
  }

  const orderList = orders ?? [];
  const cartItems = Array.isArray(cart?.items) ? cart!.items : [];

  return NextResponse.json({
    customer,
    orders: orderList,
    summary: {
      hasOrdered: orderList.length > 0,
      orderCount: orderList.length,
      totalSpent: orderList.reduce(
        (sum, o) => sum + (Number(o.total) || 0),
        0,
      ),
      hasCartItems: cartItems.length > 0,
      cartItemCount: cartItems.length,
      cartUpdatedAt: cart?.updated_at ?? null,
      referredBy,
    },
    cart: { items: cartItems, updatedAt: cart?.updated_at ?? null },
    assignment: {
      assignedAdminId: customer.assigned_admin_id,
      assignedAdminName: customer.assigned_admin_name,
      assignedAdminEmail: customer.assigned_admin_email,
      assignedAt: customer.assigned_at,
      // True when the caller themselves owns this customer.
      isMine: customer.assigned_admin_id === caller.id,
    },
    // Echo the caller so the UI can label "you" correctly.
    caller: { id: caller.id, name: caller.name, email: caller.email },
  });
}

// POST — take over this customer (claim for contacting). Admin only.
// Records the currently signed-in admin as the owner.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const caller = await getCaller(request);
  if (!caller || caller.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const { id } = await ctx.params;

  const body = await request.json().catch(() => ({}));
  // Optional guard: only claim if still unassigned (prevents silently stealing
  // a customer another admin just took). The UI passes force:true to reassign.
  const force = body?.force === true;

  const { data: existing } = await supabase
    .from('customers')
    .select('assigned_admin_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }
  if (existing.assigned_admin_id && existing.assigned_admin_id !== caller.id && !force) {
    return NextResponse.json(
      { error: 'This customer has already been taken over by another admin.' },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from('customers')
    .update({
      assigned_admin_id: caller.id,
      assigned_admin_name: caller.name,
      assigned_admin_email: caller.email,
      assigned_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('assigned_admin_id, assigned_admin_name, assigned_admin_email, assigned_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(supabase, {
    actor_id: caller.id,
    action: 'customer.takeover',
    entity_type: 'customer',
    entity_id: id,
    payload: { force },
  });

  return NextResponse.json({ success: true, assignment: data });
}

// DELETE — release this customer back to "available for taking". Admin only.
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const caller = await getCaller(request);
  if (!caller || caller.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const { id } = await ctx.params;

  const { error } = await supabase
    .from('customers')
    .update({
      assigned_admin_id: null,
      assigned_admin_name: null,
      assigned_admin_email: null,
      assigned_at: null,
    })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(supabase, {
    actor_id: caller.id,
    action: 'customer.release',
    entity_type: 'customer',
    entity_id: id,
  });

  return NextResponse.json({ success: true });
}
