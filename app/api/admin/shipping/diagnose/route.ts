import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import { diagnoseShipping } from '@/lib/shipping/easyship';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET /api/admin/shipping/diagnose
 * Admin-only. Runs the live Easyship rate path and reports why a quote did or
 * didn't come back. Optional query params override the test destination:
 *   ?postal=M5V%201A1&city=Toronto&state=ON&country=CA&address=290%20Bremner%20Blvd
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!canAccessAdmin(customer?.role || 'customer')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const destination = {
    address: sp.get('address') || '290 Bremner Blvd',
    city: sp.get('city') || 'Toronto',
    state: sp.get('state') || 'ON',
    postalCode: sp.get('postal') || 'M5V 3L9',
    country: sp.get('country') || 'CA',
  };

  const diagnostics = await diagnoseShipping(destination, [
    { quantity: 1, declaredValue: 100 },
  ]);

  return NextResponse.json({ destination, ...diagnostics });
}
