import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export async function GET() {
  // Get user from Supabase auth
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const cookieStore = await cookies();

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { cookie: cookieStore.toString() } },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const db = getSupabase();
  const { data: orders, error } = await db
    .from('orders')
    .select('order_number, status, total, crypto, payment_tx_hash, tracking_number, created_at')
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }

  return NextResponse.json(orders || []);
}
