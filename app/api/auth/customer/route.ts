import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await request.json();
    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    const admin = getSupabase();

    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (!user || userError) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    let { data: customer } = await admin
      .from('customers')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (!customer && user.email) {
      const { data: emailMatch } = await admin
        .from('customers')
        .select('*')
        .eq('email', user.email.toLowerCase())
        .maybeSingle();
      customer = emailMatch;
    }

    if (customer && customer.active === false) {
      return NextResponse.json({ error: 'Account deactivated' }, { status: 403 });
    }

    // Stamp last activity so the admin can see when staff last signed in. This
    // endpoint is hit right after every sign-in (and on app loads), so we
    // throttle to at most once every 10 minutes per user — keeping the value
    // close to "when this session started" without a write on every page load.
    // Best-effort: never fail the auth resolution because of this.
    if (customer?.id) {
      const last = customer.last_login_at ? new Date(customer.last_login_at).getTime() : 0;
      if (Date.now() - last > 10 * 60 * 1000) {
        const nowIso = new Date().toISOString();
        await admin
          .from('customers')
          .update({ last_login_at: nowIso })
          .eq('id', customer.id)
          .then(
            () => {
              customer!.last_login_at = nowIso;
            },
            () => {},
          );
      }
    }

    // Surface the bound affiliate's `manual_code_only` flag as a derived field
    // so the checkout knows whether the affiliate discount should auto-apply
    // from the binding, or wait for a referral code (typed in or via ?ref=).
    if (customer?.affiliate_id) {
      const { data: aff } = await admin
        .from('affiliates')
        .select('manual_code_only')
        .eq('id', customer.affiliate_id)
        .maybeSingle();
      (customer as Record<string, unknown>).affiliate_manual_code_only =
        aff?.manual_code_only ?? false;
    }

    return NextResponse.json({ customer });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
