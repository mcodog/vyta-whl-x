import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveCartPrices, type CartPriceLine } from '@/lib/cart-pricing';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** A cart can't hold more lines than this; anything beyond is ignored. */
const MAX_LINES = 100;

/**
 * POST /api/cart/prices
 *
 * What the lines in the caller's cart cost *them*, right now. The storefront
 * cart calls this whenever the signed-in customer resolves (page load, sign-in,
 * account switch) and replaces the prices it captured at add-to-cart time, so a
 * cart restored from localStorage can never keep quoting a price the customer
 * would not be charged.
 *
 * Auth: the customer's Supabase access token as an optional Bearer header. The
 * customer is derived from the verified token and never from the body, so this
 * can only ever return the caller's own pricing. No token is a guest, who gets
 * the catalog prices they were shown.
 *
 * Body: { items: Array<{ id, packSize }> }
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`cart-prices:${ip}`, RATE_LIMITS.general);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => ({}) as any);
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  const lines: CartPriceLine[] = rawItems
    .filter((i: any) => i && typeof i.id === 'string' && i.id)
    .slice(0, MAX_LINES)
    .map((i: any) => ({ id: String(i.id), packSize: Number(i.packSize) }));

  // Resolve the customer from the token when one was sent. An invalid or
  // expired token is treated as a guest rather than an error: the cart is
  // re-pricing in the background and must not break when a session lapses.
  let customerId: string | null = null;
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '').trim();
    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user) customerId = data.user.id;
    }
  }

  try {
    const pricing = await resolveCartPrices(supabase, customerId, lines);
    return NextResponse.json(pricing);
  } catch (err) {
    console.error('Cart re-pricing failed:', err);
    return NextResponse.json({ error: 'Could not price the cart' }, { status: 500 });
  }
}
