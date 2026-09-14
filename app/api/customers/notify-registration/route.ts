import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendNewCustomerAdminNotification } from '@/lib/email-smtp';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/customers/notify-registration
 * Best-effort: notify all configured admin emails that a new customer signed up.
 *
 * Anti-abuse: the caller must supply the auth user's id, which we verify with
 * the service-role admin API and require to match the supplied email. A random
 * caller can't forge a valid id, so this can only fire for a real account that
 * was just created (i.e. exactly the event we want to announce).
 *
 * Body: { userId: string, email: string, firstName?, lastName?, phone? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!userId || !email) {
    return NextResponse.json({ error: 'userId and email are required' }, { status: 400 });
  }

  try {
    // Verify the account actually exists and the email matches the id.
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    const authUser = userData?.user;
    if (userError || !authUser || (authUser.email ?? '').toLowerCase() !== email) {
      // Return 200 so this endpoint can't be used to probe for accounts.
      return NextResponse.json({ success: true });
    }

    const { data: settings } = await supabase
      .from('site_settings')
      .select('admin_emails')
      .maybeSingle();
    const adminEmails: string[] = settings?.admin_emails || [];

    if (adminEmails.length === 0) {
      return NextResponse.json({ success: true });
    }

    // Pull whatever profile detail exists (may be absent right after signup);
    // fall back to the values the client supplied.
    const { data: customer } = await supabase
      .from('customers')
      .select('first_name, last_name, phone, affiliate_id')
      .eq('id', userId)
      .maybeSingle();

    const firstName = customer?.first_name ?? (typeof body.firstName === 'string' ? body.firstName : '');
    const lastName = customer?.last_name ?? (typeof body.lastName === 'string' ? body.lastName : '');
    const phone = customer?.phone ?? (typeof body.phone === 'string' ? body.phone : '') ?? '';

    // Resolve the referring affiliate's name for a friendlier email (optional).
    let referredBy: string | null = null;
    if (customer?.affiliate_id) {
      const { data: affiliate } = await supabase
        .from('affiliates')
        .select('first_name, last_name, email')
        .eq('id', customer.affiliate_id)
        .maybeSingle();
      if (affiliate) {
        referredBy =
          `${affiliate.first_name ?? ''} ${affiliate.last_name ?? ''}`.trim() ||
          affiliate.email ||
          null;
      }
    }

    await sendNewCustomerAdminNotification({
      adminEmails,
      customerName: `${firstName ?? ''} ${lastName ?? ''}`.trim() || email,
      customerEmail: authUser.email ?? email,
      phone: phone || null,
      referredBy,
      registeredAt: authUser.created_at,
      customerId: userId,
    });
  } catch (err) {
    // Notifications are best-effort and must never block registration.
    console.error('Failed to notify admins of new customer registration:', err);
  }

  return NextResponse.json({ success: true });
}
