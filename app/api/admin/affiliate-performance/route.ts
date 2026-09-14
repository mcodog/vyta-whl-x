import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getRole(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return 'customer';
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return 'customer';
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  return customer?.role || 'customer';
}

/**
 * GET /api/admin/affiliate-performance
 * Per-affiliate performance: number of bound customers and total revenue from
 * those customers' orders. Returned as a map keyed by affiliate id.
 */
export async function GET(request: NextRequest) {
  const role = await getRole(request);
  if (role !== 'admin' && role !== 'assistant') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Bound customers grouped by affiliate.
  const { data: customers } = await supabase
    .from('customers')
    .select('id, affiliate_id')
    .not('affiliate_id', 'is', null);

  const customerToAffiliate = new Map<string, string>();
  const perf: Record<string, { bound_customers: number; customer_revenue: number }> = {};
  for (const c of customers ?? []) {
    customerToAffiliate.set(c.id, c.affiliate_id);
    const p = (perf[c.affiliate_id] ??= { bound_customers: 0, customer_revenue: 0 });
    p.bound_customers += 1;
  }

  // Revenue from those customers' orders.
  const customerIds = Array.from(customerToAffiliate.keys());
  if (customerIds.length > 0) {
    const { data: orders } = await supabase
      .from('orders')
      .select('customer_id, total, status')
      .in('customer_id', customerIds);
    for (const o of orders ?? []) {
      if (o.status === 'cancelled') continue;
      const affId = customerToAffiliate.get(o.customer_id);
      if (!affId) continue;
      perf[affId].customer_revenue += Number(o.total) || 0;
    }
  }

  return NextResponse.json({ performance: perf });
}
