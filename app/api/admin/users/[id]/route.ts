import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper: verify the caller is an admin
async function verifyAdmin(
  request: NextRequest,
): Promise<{ authorized: boolean; userId: string | null }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return { authorized: false, userId: null };

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return { authorized: false, userId: null };

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

  return { authorized: rows?.[0]?.role === 'admin', userId: user.id };
}

/**
 * PUT /api/admin/users/[id]
 * Updates auth credentials (email/password) and customer profile.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { authorized, userId: actorId } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const userId = params.id;
  const updates = await request.json();

  // Sync active status to Supabase Auth ban — must happen before table update
  if (updates.active !== undefined) {
    const { error: banError } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: updates.active ? 'none' : '876600h',
    });
    if (banError) {
      console.error('Error updating auth ban status:', banError);
      return NextResponse.json(
        { error: banError.message || 'Failed to update user status' },
        { status: 500 }
      );
    }
  }

  // Update auth credentials if email or password changed
  if (updates.email || updates.password) {
    const authUpdates: Record<string, string> = {};
    if (updates.email) authUpdates.email = updates.email.toLowerCase();
    if (updates.password) authUpdates.password = updates.password;

    const { error: authError } = await supabase.auth.admin.updateUserById(userId, authUpdates);
    if (authError) {
      console.error('Error updating auth user:', authError);
      return NextResponse.json(
        { error: authError.message || 'Failed to update auth user' },
        { status: 500 }
      );
    }
  }

  // Update customer profile
  const profileUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.email) profileUpdates.email = updates.email.toLowerCase();
  if (updates.first_name) profileUpdates.first_name = updates.first_name;
  if (updates.last_name) profileUpdates.last_name = updates.last_name;
  if (updates.phone !== undefined) profileUpdates.phone = updates.phone;
  if (updates.role) {
    profileUpdates.role = updates.role;
    profileUpdates.is_admin = updates.role === 'admin';
  }
  if (updates.active !== undefined) profileUpdates.active = updates.active;
  if (updates.can_send_fulfillment_emails !== undefined) {
    profileUpdates.can_send_fulfillment_emails = updates.can_send_fulfillment_emails;
  }

  const { error: profileError } = await supabase
    .from('customers')
    .update(profileUpdates)
    .eq('id', userId);

  if (profileError) {
    console.error('Error updating customer profile:', profileError);
    return NextResponse.json(
      { error: profileError.message || 'Failed to update profile' },
      { status: 500 }
    );
  }

  await logAuditServer(supabase, {
    actor_id: actorId,
    action: 'user.update',
    entity_type: 'user',
    entity_id: userId,
    payload: {
      fields: Object.keys(profileUpdates).filter((k) => k !== 'updated_at'),
    },
  });

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/admin/users/[id]
 * Hard deletes the user from both the customers table and Supabase Auth.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { authorized, userId: actorId } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const userId = params.id;

  // If this user is also an affiliate, an `affiliates` row (plus referral_codes,
  // commissions and a linked sales_person) shares the same id. Remove those
  // bound rows first so deleting the user doesn't leave an orphaned affiliate.
  const { data: boundAffiliate } = await supabase
    .from('affiliates')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (boundAffiliate) {
    // Commissions reference referral_codes (RESTRICT), so remove them first.
    await supabase.from('commissions').delete().eq('affiliate_id', userId);
    await supabase.from('referral_codes').delete().eq('affiliate_id', userId);
    await supabase.from('affiliates').delete().eq('id', userId);
  }

  // The linked sales_person record (bound via user_id), if any.
  await supabase.from('sales_persons').delete().eq('user_id', userId);

  // Delete customer profile
  const { error: profileError } = await supabase
    .from('customers')
    .delete()
    .eq('id', userId);

  if (profileError) {
    console.error('Error deleting customer profile:', profileError);
    return NextResponse.json(
      { error: profileError.message || 'Failed to delete profile' },
      { status: 500 }
    );
  }

  // Delete auth user
  const { error: authError } = await supabase.auth.admin.deleteUser(userId);
  if (authError) {
    console.error('Error deleting auth user (profile already deleted):', authError);
  }

  await logAuditServer(supabase, {
    actor_id: actorId,
    action: 'user.delete',
    entity_type: 'user',
    entity_id: userId,
  });

  return NextResponse.json({ success: true });
}
