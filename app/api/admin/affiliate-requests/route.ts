import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getRole(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return 'customer';
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return 'customer';
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  return customer?.role || 'customer';
}

/**
 * GET /api/admin/affiliate-requests?status=pending
 * Lists affiliate requests with the requesting customer's details.
 */
export async function GET(request: NextRequest) {
  const role = await getRole(request);
  if (role !== 'admin' && role !== 'assistant') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const status = request.nextUrl.searchParams.get('status') || 'pending';

  let query = supabase
    .from('affiliate_requests')
    .select('id, customer_id, status, wallet_address, message, reviewed_by, reviewed_at, created_at, customer:customers!affiliate_requests_customer_id_fkey(first_name, last_name, email)')
    .order('created_at', { ascending: false });

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching affiliate requests:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}
