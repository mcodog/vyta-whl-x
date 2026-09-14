import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Read access mirrors the products list route: admin + assistant, plus analytics
// accounts (who can open the products catalog and its per-product History view).
async function verifyReadAccess(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return false;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return false;
    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .single();
    const role = customer?.role || 'customer';
    return role === 'admin' || role === 'assistant' || role === 'analytics';
  } catch (error) {
    console.error('Error verifying history read access:', error);
    return false;
  }
}

// GET: price & stock change history for a product, newest first, with the
// display name of whoever made each change resolved.
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!(await verifyReadAccess(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { data: entries, error } = await supabase
      .from('product_change_history')
      .select('id, field, old_value, new_value, changed_by, change_source, created_at')
      .eq('product_id', params.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching product history:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = entries ?? [];

    // Resolve actor display names in one round-trip.
    const actorIds = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))] as string[];
    const actorMap = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: actors } = await supabase
        .from('customers')
        .select('id, first_name, last_name, email')
        .in('id', actorIds);
      for (const a of actors ?? []) {
        actorMap.set(
          a.id,
          [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email || 'Unknown',
        );
      }
    }

    const history = rows.map((r) => ({
      id: r.id,
      field: r.field as 'price' | 'price_usd' | 'stock_quantity' | 'vial_price',
      old_value: r.old_value === null ? null : Number(r.old_value),
      new_value: Number(r.new_value),
      change_source: r.change_source,
      changed_by: r.changed_by,
      changed_by_name: r.changed_by ? actorMap.get(r.changed_by) ?? 'Unknown' : 'System',
      created_at: r.created_at,
    }));

    return NextResponse.json({ history });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
