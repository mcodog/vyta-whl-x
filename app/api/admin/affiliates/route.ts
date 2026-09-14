import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import { logAuditServer } from '@/lib/admin/audit';
import { mergeCustomerRecords } from '@/lib/admin/customer-merge';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper: verify the caller is an admin; returns the admin's user id or null.
async function verifyAdmin(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return null;

  // Try by ID first, fall back to email (mirrors /api/auth/customer behaviour)
  let { data: rows } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id);

  if (!rows?.length && user.email) {
    const { data: emailRows } = await supabase
      .from('customers')
      .select('role')
      .eq('email', user.email.toLowerCase());
    rows = emailRows;
  }

  return rows?.[0]?.role === 'admin' ? user.id : null;
}

// Helper: resolve the caller's role (admin/assistant/…) or null.
async function getRole(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: c } = await supabase.from('customers').select('role').eq('id', user.id).maybeSingle();
  return c?.role ?? null;
}

// Whether a Supabase Auth user exists for this id. Guest customers (created
// without a login from the invoice form) have no auth user.
async function hasAuthUser(id: string): Promise<boolean> {
  const { data, error } = await supabase.auth.admin.getUserById(id);
  return !error && !!data?.user;
}

// Generate a unique 8-character alphanumeric referral code
function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Ensure the affiliate has a referral code, creating a unique one if absent.
async function ensureReferralCode(affiliateId: string): Promise<string | null> {
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
      await supabase
        .from('referral_codes')
        .insert({ affiliate_id: affiliateId, code: candidate, active: true, uses_count: 0 });
      return candidate;
    }
  }
  return null;
}

// Ensure the affiliate has their one linked sales-person row (invoice auto-lock).
async function ensureSalesPerson(
  userId: string,
  first_name: string,
  last_name: string,
  email: string,
) {
  const { data: existingSp } = await supabase
    .from('sales_persons')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!existingSp) {
    await supabase.from('sales_persons').insert({
      user_id: userId,
      first_name,
      last_name,
      email,
      active: true,
    });
  }
}

/**
 * GET /api/admin/affiliates
 * Lightweight affiliate list for the Products Report's "Affiliate" pricing
 * source picker: each affiliate with the size of its price list and the currency
 * those prices are in. Admin/assistant only.
 */
export async function GET(request: NextRequest) {
  const role = await getRole(request);
  if (role !== 'admin' && role !== 'assistant') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: affiliates, error } = await supabase
    .from('affiliates')
    .select('id, first_name, last_name, email, active')
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = affiliates ?? [];
  const ids = list.map((a) => a.id);
  const overrideCount: Record<string, number> = {};
  const currency: Record<string, 'CAD' | 'USD'> = {};

  if (ids.length) {
    const [{ data: overrides }, { data: custRows }] = await Promise.all([
      supabase.from('affiliate_price_overrides').select('affiliate_id').in('affiliate_id', ids),
      // The affiliate's own customers row (shared id) carries the price currency.
      supabase.from('customers').select('id, price_currency').in('id', ids),
    ]);
    for (const r of overrides ?? []) {
      overrideCount[r.affiliate_id] = (overrideCount[r.affiliate_id] ?? 0) + 1;
    }
    for (const r of custRows ?? []) {
      currency[r.id] = r.price_currency === 'USD' ? 'USD' : 'CAD';
    }
  }

  const affiliatesOut = list.map((a) => ({
    ...a,
    override_count: overrideCount[a.id] ?? 0,
    price_currency: currency[a.id] ?? 'CAD',
  }));

  return NextResponse.json({ affiliates: affiliatesOut });
}

/**
 * POST /api/admin/affiliates
 * Creates a new Supabase Auth user (email auto-confirmed), inserts an affiliates row
 * using the auth user's UUID as id, and creates a referral code.
 *
 * De-dup: if the email already belongs to an existing (plain) customer, the
 * request 409s with a `conflict` payload so the UI can prompt to merge. On a
 * confirmed merge (`merge_customer_id`), that customer is either promoted in
 * place (if it already has a login) or its data is folded into the new affiliate
 * (guest), so one person never ends up split across two records.
 */
export async function POST(request: NextRequest) {
  const adminId = await verifyAdmin(request);
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { first_name, last_name, password, wallet_address, active } = body;
  const email = String(body.email ?? '').toLowerCase().trim();

  if (!email || !first_name || !last_name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const wallet = wallet_address || null;
  const activeFlag = active !== undefined ? active : true;
  // Billing currency stored on the affiliate's own customers row (defaults CAD).
  const priceCurrency = body.price_currency === 'USD' ? 'USD' : 'CAD';
  const mergeCustomerId =
    typeof body.merge_customer_id === 'string' ? body.merge_customer_id : null;

  // Already an affiliate with this email — a straight duplicate, nothing to merge.
  const { data: existingAff } = await supabase
    .from('affiliates')
    .select('id')
    .ilike('email', email)
    .maybeSingle();
  if (existingAff) {
    return NextResponse.json(
      { error: 'An affiliate with this email already exists.' },
      { status: 409 },
    );
  }

  // An existing plain customer for this email — offer to promote/merge it.
  // Only plain customers qualify; admins/assistants are never auto-converted.
  // Emails aren't unique for guest customers, so take the oldest as the
  // representative (any others get folded in during the merge below).
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('id, first_name, last_name, email, role')
    .ilike('email', email)
    .eq('role', 'customer')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const existingHasLogin = existingCustomer ? await hasAuthUser(existingCustomer.id) : false;

  if (existingCustomer && mergeCustomerId !== existingCustomer.id) {
    return NextResponse.json(
      {
        error: 'This email already belongs to a customer.',
        conflict: {
          type: 'customer',
          id: existingCustomer.id,
          first_name: existingCustomer.first_name,
          last_name: existingCustomer.last_name,
          email: existingCustomer.email,
          has_login: existingHasLogin,
        },
      },
      { status: 409 },
    );
  }

  // ---- Confirmed merge, existing customer HAS a login: promote in place -----
  // Reuse their auth account & id so invoices/orders/prices carry over untouched
  // (mirrors the affiliate-request approval path).
  if (existingCustomer && mergeCustomerId === existingCustomer.id && existingHasLogin) {
    const { error: roleErr } = await supabase
      .from('customers')
      .update({ role: 'affiliate', is_admin: false, active: true, email_verified: true })
      .eq('id', existingCustomer.id);
    if (roleErr) {
      return NextResponse.json({ error: roleErr.message || 'Failed to promote customer' }, { status: 500 });
    }

    await supabase.from('affiliates').upsert(
      {
        id: existingCustomer.id,
        email,
        first_name,
        last_name,
        wallet_address: wallet,
        password_hash: '',
        active: activeFlag,
      },
      { onConflict: 'id' },
    );

    const referralCode = await ensureReferralCode(existingCustomer.id);
    await ensureSalesPerson(existingCustomer.id, first_name, last_name, email);

    await logAuditServer(supabase, {
      actor_id: adminId,
      action: 'affiliate.create',
      entity_type: 'affiliate',
      entity_id: existingCustomer.id,
      payload: { email, promoted_from_customer: existingCustomer.id },
    });

    return NextResponse.json({
      success: true,
      affiliate_id: existingCustomer.id,
      referral_code: referralCode || null,
      promoted: true,
      has_login: true,
    });
  }

  // ---- Fresh affiliate login (optionally merging a guest customer in) -------
  // Password is optional: when staff onboard via magic link we still need an
  // auth password on file, so generate a strong random one they never see.
  const effectivePassword =
    typeof password === 'string' && password.trim() ? password.trim() : randomBytes(24).toString('hex');

  // 1. Create Supabase Auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: effectivePassword,
    email_confirm: true,
    user_metadata: { first_name, last_name },
  });

  if (authError || !authData.user) {
    const msg = authError?.message || 'Failed to create auth user';
    const status = /already|exist/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  const userId = authData.user.id;

  // 2. Hash password for affiliate portal backward-compat
  const passwordHash = createHash('sha256').update(effectivePassword).digest('hex');

  // 3. Insert affiliates row using auth user's UUID
  const { error: affiliateError } = await supabase.from('affiliates').insert({
    id: userId,
    email,
    first_name,
    last_name,
    wallet_address: wallet,
    password_hash: passwordHash,
    active: activeFlag,
    total_earnings: 0,
  });

  if (affiliateError) {
    // Rollback: remove auth user
    await supabase.auth.admin.deleteUser(userId);
    return NextResponse.json(
      { error: affiliateError.message || 'Failed to create affiliate profile' },
      { status: 500 }
    );
  }

  // 4. Generate a unique referral code.
  const referralCode = await ensureReferralCode(userId);

  // 5. Unify with the role model: ensure a customers row exists with the
  //    'affiliate' role (so they can sign into /admin) and a linked sales_person.
  await supabase.from('customers').upsert(
    {
      id: userId,
      email,
      first_name,
      last_name,
      role: 'affiliate',
      active: true,
      email_verified: true,
      price_currency: priceCurrency,
    },
    { onConflict: 'id' }
  );

  await ensureSalesPerson(userId, first_name, last_name, email);

  // 6. Merge the existing (guest) customer(s) into the new affiliate record. All
  //    remaining same-email plain customers are guests (an auth-backed one would
  //    have collided at createUser above), so every one is safe to fold in.
  let merged = false;
  if (existingCustomer && mergeCustomerId === existingCustomer.id) {
    const { data: dups } = await supabase
      .from('customers')
      .select('id')
      .ilike('email', email)
      .eq('role', 'customer');
    for (const d of dups ?? []) {
      if (d.id === userId) continue;
      try {
        await mergeCustomerRecords(supabase, d.id, userId);
        merged = true;
      } catch (e) {
        console.error('Failed to merge customer into new affiliate:', e);
      }
    }
  }

  // The auth account is created with a throwaway random password; the Add
  // Affiliate dialog then emails a set-up link (/account/set-password) so the
  // affiliate chooses their own password before entering the admin portal.
  await logAuditServer(supabase, {
    actor_id: adminId,
    action: 'affiliate.create',
    entity_type: 'affiliate',
    entity_id: userId,
    payload: { email, ...(merged ? { merged_from_customer: existingCustomer!.id } : {}) },
  });

  return NextResponse.json({ success: true, affiliate_id: userId, referral_code: referralCode || null, merged });
}
