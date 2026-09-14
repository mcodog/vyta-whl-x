import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/customers/cart
 * Persist a snapshot of the signed-in customer's current cart so admins can see
 * on the takeover page whether the customer has added anything to their cart
 * (there is no other server-side record of the cart — it lives in the browser).
 *
 * Auth: the customer's Supabase access token as a Bearer header. We derive the
 * customer id from the verified token, so a caller can only write their own cart.
 *
 * Body: { items: Array<{ id, name, price, strength, packSize, quantity }> }
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rawItems = Array.isArray(body.items) ? body.items : [];

  // Keep only a lean, trusted subset of each line — enough to show the admin
  // what's in the cart, without trusting arbitrary client fields.
  const items = rawItems
    .filter((i: any) => i && typeof i.id === 'string')
    .slice(0, 100)
    .map((i: any) => ({
      id: String(i.id),
      name: typeof i.name === 'string' ? i.name.slice(0, 200) : '',
      strength: typeof i.strength === 'string' ? i.strength.slice(0, 50) : '',
      price: Number(i.price) || 0,
      packSize: Number(i.packSize) || 1,
      quantity: Number(i.quantity) || 0,
    }));

  const { error } = await supabase.from('customer_carts').upsert(
    {
      customer_id: user.id,
      items,
      item_count: items.length,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'customer_id' },
  );

  if (error) {
    // Non-fatal: cart sync should never break the store. Log and 200 so the
    // client doesn't retry-storm. (A missing table pre-migration lands here.)
    console.error('Failed to sync customer cart:', error);
    return NextResponse.json({ success: false });
  }

  return NextResponse.json({ success: true });
}
