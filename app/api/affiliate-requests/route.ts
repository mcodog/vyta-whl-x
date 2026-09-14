import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendAffiliateRequestAdminNotification } from '@/lib/email-smtp';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Resolve the calling customer from a Bearer token.
async function getCaller(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: customer } = await supabase
    .from('customers')
    .select('id, email, first_name, last_name, role')
    .eq('id', user.id)
    .maybeSingle();
  return customer;
}

/**
 * GET /api/affiliate-requests
 * Returns the caller's most recent affiliate request (for the apply page state).
 */
export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('affiliate_requests')
    .select('id, status, created_at, reviewed_at')
    .eq('customer_id', caller.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ request: data ?? null, role: caller.role });
}

/**
 * POST /api/affiliate-requests
 * Authenticated customer requests to become an affiliate.
 * Body: { wallet_address?: string, message?: string }
 */
export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (caller.role === 'affiliate') {
    return NextResponse.json({ error: 'You are already an affiliate' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const walletAddress = (body.wallet_address ?? '').trim() || null;
  const message = (body.message ?? '').trim() || null;

  // Idempotent: an existing pending request just succeeds.
  const { data: existing } = await supabase
    .from('affiliate_requests')
    .select('id')
    .eq('customer_id', caller.id)
    .eq('status', 'pending')
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ success: true, alreadyPending: true });
  }

  const { error: insertError } = await supabase.from('affiliate_requests').insert({
    customer_id: caller.id,
    wallet_address: walletAddress,
    message,
    status: 'pending',
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ success: true, alreadyPending: true });
    }
    console.error('Error creating affiliate request:', insertError);
    return NextResponse.json({ error: 'Could not submit your request' }, { status: 500 });
  }

  // Notify admins (best-effort).
  try {
    const { data: settings } = await supabase
      .from('site_settings')
      .select('admin_emails')
      .maybeSingle();
    const adminEmails: string[] = settings?.admin_emails || [];
    if (adminEmails.length > 0) {
      await sendAffiliateRequestAdminNotification({
        adminEmails,
        applicantName: `${caller.first_name ?? ''} ${caller.last_name ?? ''}`.trim() || caller.email,
        applicantEmail: caller.email,
        message,
        walletAddress,
      });
    }
  } catch (err) {
    console.error('Failed to notify admins of affiliate request:', err);
  }

  return NextResponse.json({ success: true });
}
