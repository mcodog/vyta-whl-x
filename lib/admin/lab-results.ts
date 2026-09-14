import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canCreate } from '@/lib/permissions';

/**
 * Verify the caller is admin/assistant. When `requireMutation` is set, only
 * roles allowed to create/edit (admins) pass. Shared by the lab-results admin
 * routes so the auth logic lives in one place.
 */
export async function verifyLabResultsAccess(
  supabase: SupabaseClient,
  request: NextRequest,
  requireMutation = false
): Promise<{ authorized: boolean; role: string; userId: string | null }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return { authorized: false, role: 'customer', userId: null };

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authorized: false, role: 'customer', userId: null };

    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .single();
    const role = customer?.role || 'customer';

    if (requireMutation) return { authorized: canCreate(role), role, userId: user.id };
    return { authorized: role === 'admin' || role === 'assistant', role, userId: user.id };
  } catch (e) {
    console.error('Error verifying lab-results access:', e);
    return { authorized: false, role: 'customer', userId: null };
  }
}

// Fields a client may set on a lab result.
export const LAB_RESULT_EDITABLE_FIELDS = [
  'report_url',
  'product_name',
  'lab',
  'sample_id',
  'compound',
  'cas_number',
  'purity_pct',
  'method',
  'matrix',
  'receiving_date',
  'registration_date',
  'report_date',
  'active',
] as const;

/**
 * Normalise an incoming payload into a clean column patch: empty strings become
 * null, purity is coerced to a number-or-null, and active to a strict boolean.
 * Only whitelisted, present keys are included.
 */
export function sanitizeLabResult(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of LAB_RESULT_EDITABLE_FIELDS) {
    if (!(key in body)) continue;
    let value = body[key];

    if (key === 'active') {
      patch.active = value === true || value === 'true';
      continue;
    }
    if (key === 'purity_pct') {
      if (value === '' || value === null || value === undefined) {
        patch.purity_pct = null;
      } else {
        const n = typeof value === 'number' ? value : parseFloat(String(value));
        patch.purity_pct = Number.isFinite(n) ? n : null;
      }
      continue;
    }
    if (typeof value === 'string') {
      value = value.trim();
      if (value === '') value = null;
    }
    patch[key] = value;
  }
  return patch;
}
