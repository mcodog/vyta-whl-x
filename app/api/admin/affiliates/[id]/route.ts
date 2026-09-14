import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { logAuditServer } from '@/lib/admin/audit';

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

/**
 * PUT /api/admin/affiliates/[id]
 * Updates auth credentials (email/password/ban) and affiliate profile.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const adminId = await verifyAdmin(request);
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const affiliateId = params.id;
  const updates = await request.json();

  // Sync active status to Supabase Auth ban
  if (updates.active !== undefined) {
    const { error: banError } = await supabase.auth.admin.updateUserById(affiliateId, {
      ban_duration: updates.active ? 'none' : '876600h',
    });
    if (banError) {
      return NextResponse.json(
        { error: banError.message || 'Failed to update auth ban status' },
        { status: 500 }
      );
    }
  }

  // Update auth credentials if email or password changed
  if (updates.email || updates.password) {
    const authUpdates: Record<string, string> = {};
    if (updates.email) authUpdates.email = updates.email.toLowerCase();
    if (updates.password) authUpdates.password = updates.password;

    const { error: authError } = await supabase.auth.admin.updateUserById(affiliateId, authUpdates);
    if (authError) {
      return NextResponse.json(
        { error: authError.message || 'Failed to update auth user' },
        { status: 500 }
      );
    }
  }

  // Build affiliates table update
  const profileUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.email) profileUpdates.email = updates.email.toLowerCase();
  if (updates.first_name) profileUpdates.first_name = updates.first_name;
  if (updates.last_name) profileUpdates.last_name = updates.last_name;
  if (updates.wallet_address !== undefined) profileUpdates.wallet_address = updates.wallet_address || null;
  if (updates.active !== undefined) profileUpdates.active = updates.active;
  if (updates.manual_code_only !== undefined) profileUpdates.manual_code_only = Boolean(updates.manual_code_only);
  if (updates.password) {
    profileUpdates.password_hash = createHash('sha256').update(updates.password).digest('hex');
  }

  const { error: profileError } = await supabase
    .from('affiliates')
    .update(profileUpdates)
    .eq('id', affiliateId);

  if (profileError) {
    return NextResponse.json(
      { error: profileError.message || 'Failed to update affiliate profile' },
      { status: 500 }
    );
  }

  // Keep the sibling rows that share this identity in sync so the merged Sales
  // People view and the customers table don't drift from the affiliate profile
  // (one person = affiliates + customers + sales_persons rows; see ADR 0003).
  // Name/email are mirrored to both customers and sales_persons; the billing
  // currency lives ONLY on the customers row (customers.price_currency) — the
  // single source the invoice form and price-list logic already read — so it is
  // never written to sales_persons (which has no such column).
  const nameEmailSync: Record<string, unknown> = {};
  if (updates.first_name) nameEmailSync.first_name = updates.first_name;
  if (updates.last_name) nameEmailSync.last_name = updates.last_name;
  if (updates.email) nameEmailSync.email = updates.email.toLowerCase();

  const priceCurrency =
    updates.price_currency === 'CAD' || updates.price_currency === 'USD'
      ? updates.price_currency
      : null;

  const customerSync = { ...nameEmailSync, ...(priceCurrency ? { price_currency: priceCurrency } : {}) };
  if (Object.keys(customerSync).length > 0) {
    await supabase.from('customers').update(customerSync).eq('id', affiliateId);
  }
  if (Object.keys(nameEmailSync).length > 0) {
    await supabase.from('sales_persons').update(nameEmailSync).eq('user_id', affiliateId);
  }

  await logAuditServer(supabase, {
    actor_id: adminId,
    action: 'affiliate.update',
    entity_type: 'affiliate',
    entity_id: affiliateId,
    payload: {
      fields: [
        ...Object.keys(profileUpdates).filter((k) => k !== 'password_hash'),
        ...(priceCurrency ? ['price_currency'] : []),
      ],
    },
  });

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/admin/affiliates/[id]
 * Hard deletes affiliate: removes referral_codes, affiliates row, and auth user.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const adminId = await verifyAdmin(request);
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const affiliateId = params.id;

  // An affiliate is created with several bound rows that all share the auth
  // user's UUID as their id (see POST in ../route.ts): an `affiliates` row, a
  // `customers` row (role 'affiliate'), a linked `sales_persons` row, plus
  // `referral_codes` and `commissions`. Delete them in FK-safe order so the
  // affiliate is fully removed rather than leaving orphaned rows behind.

  // Commissions reference referral_codes (RESTRICT), so remove them first.
  await supabase.from('commissions').delete().eq('affiliate_id', affiliateId);

  // Then the referral codes.
  await supabase.from('referral_codes').delete().eq('affiliate_id', affiliateId);

  // The linked sales_person record (bound via user_id).
  await supabase.from('sales_persons').delete().eq('user_id', affiliateId);

  // Delete affiliate profile.
  const { error: profileError } = await supabase
    .from('affiliates')
    .delete()
    .eq('id', affiliateId);

  if (profileError) {
    return NextResponse.json(
      { error: profileError.message || 'Failed to delete affiliate' },
      { status: 500 }
    );
  }

  // Delete the bound customers row (same id as the auth user / affiliate).
  await supabase.from('customers').delete().eq('id', affiliateId);

  // Delete auth user
  await supabase.auth.admin.deleteUser(affiliateId);

  await logAuditServer(supabase, {
    actor_id: adminId,
    action: 'affiliate.delete',
    entity_type: 'affiliate',
    entity_id: affiliateId,
  });

  return NextResponse.json({ success: true });
}
