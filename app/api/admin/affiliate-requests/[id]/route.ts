import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendAffiliateRequestDecision } from '@/lib/email-smtp';
import { logAuditServer } from '@/lib/admin/audit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Returns the admin caller's user id, or null if not an admin.
async function getAdmin(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  return customer?.role === 'admin' ? user.id : null;
}

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function createUniqueReferralCode(affiliateId: string) {
  // Don't create a second code if one already exists.
  const { data: existing } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('affiliate_id', affiliateId)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.code;

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateReferralCode();
    const { data: clash } = await supabase
      .from('referral_codes')
      .select('id')
      .eq('code', candidate)
      .maybeSingle();
    if (!clash) {
      await supabase.from('referral_codes').insert({
        affiliate_id: affiliateId,
        code: candidate,
        active: true,
        uses_count: 0,
      });
      return candidate;
    }
  }
  return null;
}

/**
 * PATCH /api/admin/affiliate-requests/[id]
 * Body: { action: 'approve' | 'deny' }
 * Approving promotes the customer to the affiliate role and provisions their
 * affiliate record, referral code and linked sales-person.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const adminId = await getAdmin(request);
  if (!adminId) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = body.action as 'approve' | 'deny';
  if (action !== 'approve' && action !== 'deny') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  // Load the request + the requesting customer.
  const { data: req, error: reqError } = await supabase
    .from('affiliate_requests')
    .select('id, customer_id, status, wallet_address')
    .eq('id', params.id)
    .maybeSingle();

  if (reqError || !req) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }
  if (req.status !== 'pending') {
    return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 });
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('id, email, first_name, last_name')
    .eq('id', req.customer_id)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }

  const reviewStamp = { reviewed_by: adminId, reviewed_at: new Date().toISOString() };

  if (action === 'deny') {
    await supabase
      .from('affiliate_requests')
      .update({ status: 'denied', ...reviewStamp })
      .eq('id', req.id);

    sendAffiliateRequestDecision({
      to: customer.email,
      applicantName: customer.first_name || customer.email,
      approved: false,
    }).catch((e) => console.error('Affiliate denial email failed:', e));

    await logAuditServer(supabase, {
      actor_id: adminId,
      action: 'affiliate_request.reject',
      entity_type: 'affiliate_request',
      entity_id: req.id,
      payload: { customer_id: customer.id, email: customer.email },
    });

    return NextResponse.json({ success: true, status: 'denied' });
  }

  // APPROVE -----------------------------------------------------------------
  // 1. Promote to the affiliate role.
  const { error: roleError } = await supabase
    .from('customers')
    .update({ role: 'affiliate' })
    .eq('id', customer.id);
  if (roleError) {
    console.error('Error promoting customer to affiliate:', roleError);
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
  }

  // 2. Provision the affiliate record (id == customer/auth id). password_hash
  //    is unused now that affiliates log in via Supabase auth, but is NOT NULL.
  await supabase.from('affiliates').upsert(
    {
      id: customer.id,
      email: customer.email,
      first_name: customer.first_name || '',
      last_name: customer.last_name || '',
      wallet_address: req.wallet_address || null,
      password_hash: '',
      active: true,
    },
    { onConflict: 'id' }
  );

  // 3. Referral code.
  const referralCode = await createUniqueReferralCode(customer.id);

  // 4. Linked sales-person (for the invoice auto-lock). One per user.
  const { data: existingSp } = await supabase
    .from('sales_persons')
    .select('id')
    .eq('user_id', customer.id)
    .maybeSingle();
  if (!existingSp) {
    await supabase.from('sales_persons').insert({
      user_id: customer.id,
      first_name: customer.first_name || '',
      last_name: customer.last_name || '',
      email: customer.email,
      active: true,
    });
  }

  // 5. Mark request approved.
  await supabase
    .from('affiliate_requests')
    .update({ status: 'approved', ...reviewStamp })
    .eq('id', req.id);

  sendAffiliateRequestDecision({
    to: customer.email,
    applicantName: customer.first_name || customer.email,
    approved: true,
    referralCode,
  }).catch((e) => console.error('Affiliate approval email failed:', e));

  await logAuditServer(supabase, {
    actor_id: adminId,
    action: 'affiliate_request.approve',
    entity_type: 'affiliate_request',
    entity_id: req.id,
    payload: { customer_id: customer.id, email: customer.email },
  });

  return NextResponse.json({ success: true, status: 'approved', referralCode });
}
