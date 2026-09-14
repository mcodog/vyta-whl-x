import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { sendStockReportEmail } from '@/lib/admin/stock-report-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Scheduled Stock Report email.
 *
 * Sends the (money-free) Stock Report to the configured recipients when a send
 * is due for the configured cadence. Scheduled from Supabase via pg_cron +
 * pg_net once a day (see stock-report-email-migration.sql); this route enforces
 * the daily / weekly / monthly frequency itself, so the cron expression never
 * needs to change.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`. Both GET and POST are accepted
 * so pg_net.http_post works and the job can be triggered manually for testing.
 */

// Minimum hours since the last send before the next one is due, per cadence.
// Thresholds sit just under the nominal period so a cron that fires a little
// early on the target day still counts as due.
const DUE_THRESHOLD_HOURS: Record<string, number> = {
  daily: 20,
  weekly: 156, // ~6.5 days
  monthly: 648, // ~27 days
};

function isDue(frequency: string, lastSentAt: string | null, now: Date): boolean {
  const threshold = DUE_THRESHOLD_HOURS[frequency] ?? DUE_THRESHOLD_HOURS.weekly;
  if (!lastSentAt) return true;
  const last = new Date(lastSentAt).getTime();
  if (Number.isNaN(last)) return true;
  const hours = (now.getTime() - last) / (1000 * 60 * 60);
  return hours >= threshold;
}

async function handle(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getSupabase();
  const { data: settings, error } = await db
    .from('site_settings')
    .select(
      'id, stock_report_email_enabled, stock_report_email_recipients, stock_report_email_frequency, stock_report_email_last_sent_at',
    )
    .single();

  if (error || !settings) {
    console.error('stock-report-email: failed to load settings:', error);
    return NextResponse.json({ ok: false, error: 'Settings unavailable' }, { status: 500 });
  }

  if (!settings.stock_report_email_enabled) {
    return NextResponse.json({ ok: true, skipped: 'disabled' });
  }

  const recipients: string[] = Array.isArray(settings.stock_report_email_recipients)
    ? settings.stock_report_email_recipients
    : [];
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'no recipients' });
  }

  const frequency = settings.stock_report_email_frequency || 'weekly';
  const now = new Date();
  if (!isDue(frequency, settings.stock_report_email_last_sent_at, now)) {
    return NextResponse.json({ ok: true, skipped: 'not due', frequency });
  }

  const result = await sendStockReportEmail(db, recipients);
  if (!result.success) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  // Stamp the send so the next run measures the interval from here.
  await db
    .from('site_settings')
    .update({ stock_report_email_last_sent_at: now.toISOString() })
    .eq('id', settings.id);

  return NextResponse.json({
    ok: true,
    sent: true,
    frequency,
    recipients: recipients.length,
    totals: result.totals,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
