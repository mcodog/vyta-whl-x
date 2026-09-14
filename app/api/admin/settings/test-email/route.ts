import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import { sendTestEmail, isTestEmailType } from '@/lib/email-test';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/admin/settings/test-email
 * Sends a sample of one transactional email type to the configured admin
 * notification addresses (or an optional explicit `to` override).
 *
 * Admin-only (assistants are read-only). Body: { type: string, to?: string }
 */
export async function POST(req: NextRequest) {
  // --- Auth (mirrors the settings PUT route) ---
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .single();
  const role = customer?.role || 'customer';
  if (!canAccessAdmin(role) || role === 'assistant') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  // --- Input ---
  const body = await req.json().catch(() => ({}));
  const type = typeof body.type === 'string' ? body.type : '';
  if (!type || !isTestEmailType(type)) {
    return NextResponse.json({ error: 'Unknown email type' }, { status: 400 });
  }

  // --- Recipients: explicit selection (string or list), else all admin emails ---
  // `to` may be a single address or an array of addresses.
  const rawTo: unknown[] =
    typeof body.to === 'string'
      ? [body.to]
      : Array.isArray(body.to)
      ? body.to
      : [];
  const requested = rawTo
    .map((e) => (typeof e === 'string' ? e.trim() : ''))
    .filter(Boolean);

  let recipients: string[];
  if (requested.length > 0) {
    // Validate every requested recipient.
    const invalid = requested.find((e) => !emailRegex.test(e));
    if (invalid) {
      return NextResponse.json({ error: `Invalid recipient email: ${invalid}` }, { status: 400 });
    }
    recipients = Array.from(new Set(requested));
  } else {
    const { data: settings } = await supabase
      .from('site_settings')
      .select('admin_emails')
      .maybeSingle();
    recipients = (settings?.admin_emails || []).filter(
      (e: unknown): e is string => typeof e === 'string' && emailRegex.test(e),
    );
  }

  if (recipients.length === 0) {
    return NextResponse.json(
      { error: 'Select at least one recipient before sending a test.' },
      { status: 400 },
    );
  }

  const result = await sendTestEmail(type, recipients);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error || 'Failed to send test email' },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, sentTo: recipients });
}
