import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { sendInactiveCustomerAdminNotification } from '@/lib/email-smtp';

/**
 * Inactive-customer alert job.
 *
 * Finds customers who registered but still haven't ordered, and emails the
 * admin list once for each configured day-threshold (site_settings
 * .inactive_customer_notify_days, e.g. 3, 7, 14).
 *
 * Scheduled from Supabase via pg_cron + pg_net (see
 * inactive-customer-notifications-and-takeover-migration.sql) — not an external
 * cron. Both GET and POST are accepted so pg_net.http_post works and the job can
 * also be triggered manually for testing.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 */

// A threshold D fires when the customer's age (in days) is within [D, D+GRACE].
// The grace window tolerates a missed daily run and stops old accounts (already
// well past every threshold) from being back-filled with a flood of alerts the
// first time the feature is switched on.
const GRACE_DAYS = 2;
const DAY_MS = 1000 * 60 * 60 * 24;

async function handle(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getSupabase();

  // Load config off the singleton settings row.
  const { data: settings } = await db
    .from('site_settings')
    .select(
      'admin_emails, inactive_customer_notification_enabled, inactive_customer_notify_days',
    )
    .maybeSingle();

  const enabled = settings?.inactive_customer_notification_enabled === true;
  const adminEmails: string[] = Array.isArray(settings?.admin_emails)
    ? settings!.admin_emails
    : [];
  const thresholds: number[] = Array.isArray(settings?.inactive_customer_notify_days)
    ? (settings!.inactive_customer_notify_days as unknown[])
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d > 0)
        .sort((a, b) => a - b)
    : [];

  if (!enabled || thresholds.length === 0 || adminEmails.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: !enabled
        ? 'disabled'
        : thresholds.length === 0
          ? 'no thresholds configured'
          : 'no admin emails configured',
    });
  }

  const now = Date.now();
  const minDays = thresholds[0];
  const maxDays = thresholds[thresholds.length - 1] + GRACE_DAYS;

  // Candidate window: registered at least `minDays` ago but no earlier than
  // `maxDays` ago — anyone older has already passed every threshold's window.
  const newestEligible = new Date(now - minDays * DAY_MS).toISOString();
  const oldestEligible = new Date(now - maxDays * DAY_MS).toISOString();

  const { data: candidates, error: candErr } = await db
    .from('customers')
    .select('id, first_name, last_name, email, phone, created_at')
    .eq('role', 'customer')
    .eq('active', true)
    .lte('created_at', newestEligible)
    .gte('created_at', oldestEligible);

  if (candErr) {
    console.error('Inactive-customer cron: failed to load candidates:', candErr);
    return NextResponse.json({ error: 'Failed to load customers' }, { status: 500 });
  }

  let evaluated = 0;
  let sent = 0;
  const errors: string[] = [];

  for (const c of candidates ?? []) {
    evaluated++;
    const ageDays = Math.floor((now - new Date(c.created_at).getTime()) / DAY_MS);

    // Highest threshold whose grace window currently contains this customer.
    const due = [...thresholds]
      .reverse()
      .find((d) => ageDays >= d && ageDays <= d + GRACE_DAYS);
    if (due === undefined) continue;

    // Already ordered? (match by id and by email to catch guest-checkout rows.)
    let orderQ = db.from('orders').select('id', { count: 'exact', head: true });
    orderQ = c.email
      ? orderQ.or(`customer_id.eq.${c.id},email.eq.${c.email}`)
      : orderQ.eq('customer_id', c.id);
    const { count: orderCount } = await orderQ;
    if ((orderCount ?? 0) > 0) continue;

    // Already alerted for this threshold?
    const { data: alreadySent } = await db
      .from('customer_inactive_notifications')
      .select('id')
      .eq('customer_id', c.id)
      .eq('days_threshold', due)
      .maybeSingle();
    if (alreadySent) continue;

    // Does the customer currently have items in their cart?
    const { data: cart } = await db
      .from('customer_carts')
      .select('item_count')
      .eq('customer_id', c.id)
      .maybeSingle();
    const hasCartItems = (cart?.item_count ?? 0) > 0;

    // Record first (idempotent unique constraint) so a send retry can't double
    // up. If the insert loses a race, another worker already handled it.
    const { error: insErr } = await db
      .from('customer_inactive_notifications')
      .insert({ customer_id: c.id, days_threshold: due });
    if (insErr) {
      // 23505 = unique violation → someone else recorded it; skip quietly.
      if ((insErr as any).code !== '23505') {
        errors.push(`record ${c.id}: ${insErr.message}`);
      }
      continue;
    }

    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email;
    const result = await sendInactiveCustomerAdminNotification({
      adminEmails,
      customerName: name,
      customerEmail: c.email,
      phone: c.phone,
      daysSinceRegistration: due,
      registeredAt: c.created_at,
      hasCartItems,
      customerId: c.id,
    });
    if (result.success) {
      sent++;
    } else {
      errors.push(`email ${c.id}: ${result.error}`);
    }
  }

  return NextResponse.json({
    ok: true,
    evaluated,
    sent,
    thresholds,
    ...(errors.length ? { errors } : {}),
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
