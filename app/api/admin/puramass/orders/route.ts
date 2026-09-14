import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logErrorServer } from '@/lib/admin/errorLog';

/**
 * GET /api/admin/puramass/orders
 *
 * Paginated read of the PuraMass hosted-checkout hand-off ledger
 * (`puramass_orders`), newest first. Read-only; admin/assistant only. Live
 * payment status lives in the PuraMass portal — this surfaces the local record
 * (partner_reference ↔ transaction_id ↔ payment_link) for reconciliation.
 *
 * Query params: `page` (0-indexed), `pageSize` (1–100, default 25).
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyReader(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return false;
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = customer?.role ?? 'customer';
  return role === 'admin' || role === 'assistant';
}

export async function GET(request: NextRequest) {
  if (!(await verifyReader(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(0, Number(searchParams.get('page')) || 0);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 25));
  const from = page * pageSize;
  const to = from + pageSize - 1;

  // Prefer the fuller column set (paid_at/currency come from the webhook-status
  // migration); fall back if that migration hasn't run yet.
  const FULL_COLS =
    'id, partner_reference, transaction_id, payment_link, status, subtotal_cents, currency, paid_at, customer_email, items, referral_code, created_at';
  const BASE_COLS =
    'id, partner_reference, transaction_id, payment_link, status, subtotal_cents, customer_email, items, referral_code, created_at';

  try {
    let { data, count, error } = await supabase
      .from('puramass_orders')
      .select(FULL_COLS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      ({ data, count, error } = await supabase
        .from('puramass_orders')
        .select(BASE_COLS, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to));
    }
    if (error) throw error;

    return NextResponse.json({
      orders: data ?? [],
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'puramass-orders',
      route: '/api/admin/puramass/orders',
      method: 'GET',
      error,
    });
    return NextResponse.json(
      { error: 'Failed to load PuraMass orders' },
      { status: 500 },
    );
  }
}
