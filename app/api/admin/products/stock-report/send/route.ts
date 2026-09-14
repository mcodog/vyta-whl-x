import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendStockReportEmail } from '@/lib/admin/stock-report-email';
import { recordAudit } from '@/lib/admin/recordAudit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getRole(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return { role: 'customer', userId: null as string | null };
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { role: 'customer', userId: null };
  const { data: c } = await supabase.from('customers').select('role').eq('id', user.id).maybeSingle();
  return { role: c?.role || 'customer', userId: user.id };
}

/**
 * Send the Stock Report by email right now (manual / test send). Admins and
 * assistants can trigger it. Recipients come from the request body when given,
 * otherwise from the configured schedule recipients. This does NOT touch the
 * schedule's last-sent marker — it's a one-off, separate from the cron cadence.
 */
export async function POST(request: NextRequest) {
  const { role, userId } = await getRole(request);
  if (role !== 'admin' && role !== 'assistant') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  let recipients: string[] = [];
  if (Array.isArray(body?.recipients)) {
    recipients = body.recipients;
  } else {
    const { data: settings } = await supabase
      .from('site_settings')
      .select('stock_report_email_recipients')
      .single();
    recipients = Array.isArray(settings?.stock_report_email_recipients)
      ? settings!.stock_report_email_recipients
      : [];
  }

  const cleaned = recipients.map((r) => String(r).trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return NextResponse.json({ error: 'No recipients provided' }, { status: 400 });
  }
  const invalid = cleaned.find((e) => !emailRegex.test(e));
  if (invalid) {
    return NextResponse.json({ error: `Invalid email: ${invalid}` }, { status: 400 });
  }

  const result = await sendStockReportEmail(supabase, cleaned);
  if (!result.success) {
    return NextResponse.json({ error: result.error || 'Failed to send' }, { status: 500 });
  }

  await recordAudit({
    supabase,
    actorId: userId,
    action: 'stock_report.send',
    entityType: 'stock_report',
    payload: { recipients: cleaned.length },
  });

  return NextResponse.json({ success: true, recipients: cleaned.length, totals: result.totals });
}
