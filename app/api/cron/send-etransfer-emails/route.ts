import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { claimAndSendEtransferEmail } from '@/lib/etransfer-email';

/**
 * Delayed checkout invoice email flush job.
 *
 * Sends the customer invoice email — Interac e-Transfer wording, or Bitcoin
 * deposit instructions for an order placed to be paid in BTC — for any
 * in-house checkout order that has come due (etransfer_email_send_after <= now)
 * and hasn't been sent yet. Instant (0-minute) orders are sent by the order API
 * itself; this job handles delayed sends and retries any instant send that
 * failed.
 *
 * Scheduled from Supabase via pg_cron + pg_net every minute (see
 * etransfer-email-automation-migration.sql) — not an external cron. Both GET
 * and POST are accepted so pg_net.http_post works and the job can also be
 * triggered manually for testing.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 */

async function handle(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getSupabase();
  const nowIso = new Date().toISOString();

  // Due + unsent checkout orders. `crypto` doubles as the payment-method
  // column, so both of the checkout's methods are collected here — a Bitcoin
  // order's instructions are as delayed-sendable as an e-Transfer's. Cap the
  // batch so one run can't run long.
  const { data: orders, error } = await db
    .from('orders')
    .select(
      'id, order_number, email, items, total, discount_amount, shipping_address, referral_code, fulfillment_type, notes, currency, crypto',
    )
    .in('crypto', ['email', 'btc'])
    .not('email', 'is', null)
    .neq('status', 'cancelled')
    .is('etransfer_email_sent_at', null)
    .lte('etransfer_email_send_after', nowIso)
    .order('etransfer_email_send_after', { ascending: true })
    .limit(100);

  if (error) {
    console.error('send-etransfer-emails: failed to load due orders:', error);
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of orders ?? []) {
    const result = await claimAndSendEtransferEmail(db, order);
    if (result === 'sent') sent++;
    else if (result === 'skipped') skipped++;
    else failed++;
  }

  return NextResponse.json({
    ok: true,
    due: orders?.length ?? 0,
    sent,
    skipped,
    failed,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
