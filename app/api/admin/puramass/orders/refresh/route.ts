import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  isPuramassConfigured,
  fetchPuramassOrderStatus,
  PuramassApiError,
} from '@/lib/payments/puramass';
import { logErrorServer } from '@/lib/admin/errorLog';

/**
 * POST /api/admin/puramass/orders/refresh   { transaction_id }
 *
 * Poll `GET /partner/store/orders/{transaction_id}` and update the matching
 * `puramass_orders` row's status/paid_at/currency/subtotal. Manual fallback to
 * the webhook — also backfills events that fired before the webhook URL was
 * registered. Admin/assistant only.
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

export async function POST(request: NextRequest) {
  if (!(await verifyReader(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  if (!isPuramassConfigured()) {
    return NextResponse.json({ error: 'PuraMass is not configured.' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const transactionId =
    typeof body?.transaction_id === 'string' ? body.transaction_id.trim() : '';
  if (!transactionId) {
    return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 });
  }

  try {
    const status = await fetchPuramassOrderStatus(transactionId);
    const update: Record<string, unknown> = { status: status.status };
    if (status.currency) update.currency = status.currency;
    if (typeof status.subtotal_cents === 'number') update.subtotal_cents = status.subtotal_cents;
    if (status.paid_at) update.paid_at = status.paid_at;

    const { error } = await supabase
      .from('puramass_orders')
      .update(update)
      .eq('transaction_id', transactionId);
    if (error) throw error;

    return NextResponse.json({ ok: true, status: status.status, paid_at: status.paid_at ?? null });
  } catch (err) {
    if (err instanceof PuramassApiError) {
      const code = err.status >= 400 && err.status < 500 ? err.status : 502;
      return NextResponse.json({ error: err.message }, { status: code });
    }
    await logErrorServer(supabase, {
      area: 'puramass-orders',
      route: '/api/admin/puramass/orders/refresh',
      method: 'POST',
      error: err,
    });
    return NextResponse.json({ error: 'Refresh failed' }, { status: 500 });
  }
}
