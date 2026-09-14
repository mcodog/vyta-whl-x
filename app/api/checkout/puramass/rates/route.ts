import { NextResponse } from 'next/server';
import { getSupabase, supabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import {
  getPuramassShippingOptions,
  getPuramassShippingSettings,
} from '@/lib/payments/puramass-shipping';
import {
  declaredValueItems,
  priceCheckoutLines,
  type CheckoutLine,
} from '@/lib/payments/puramass-pricing';
import { puramassCheckoutEnabledByConfig } from '@/puramass.config';

/**
 * POST /api/checkout/puramass/rates
 *
 * Courier options for the PuraMass hosted checkout: UPS, FedEx and Canada Post
 * rates to the recipient address, in the customer's own billing currency, with
 * the configured processing fee already added on top of each one.
 *
 * The cart is priced server-side here too — the declared value Easyship rates
 * against is the customer's own pricing, not a figure from the browser.
 *
 * The customer picks an option by `courierId`; `/api/checkout/puramass` re-quotes
 * that id when it mints the payment link, so what is charged is always a live
 * rate rather than anything echoed back by the client.
 *
 * Gated by the same feature toggle as the rest of the flow — off means the
 * hosted checkout collects no address and PuraMass handles shipping on its page.
 */

interface IncomingItem {
  id: string;
  quantity: number;
  packSize?: number;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`puramass-rates:${ip}`, RATE_LIMITS.general);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  if (!puramassCheckoutEnabledByConfig()) {
    return NextResponse.json({ error: 'PuraMass checkout is disabled.' }, { status: 403 });
  }

  const db = getSupabase();
  const settings = await getPuramassShippingSettings(db);
  if (!settings.enabled) {
    return NextResponse.json(
      { error: 'Courier selection is not enabled.' },
      { status: 403 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const dest = body?.destination ?? {};
  const postalCode = typeof dest.postalCode === 'string' ? dest.postalCode.trim() : '';
  if (!postalCode) {
    return NextResponse.json(
      { error: 'A destination postal code is required.' },
      { status: 400 },
    );
  }

  const rawItems: IncomingItem[] = Array.isArray(body?.items) ? body.items : [];
  const lines: CheckoutLine[] = [];
  for (const it of rawItems) {
    if (!it || typeof it.id !== 'string') continue;
    const qty = Number(it.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    lines.push({ id: it.id, packSize: it.packSize === 1 ? 1 : 10, quantity: qty });
  }
  if (!lines.length) {
    return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 });
  }

  // Best-effort: a signed-in customer's own pricing and currency. An anonymous
  // request still gets rates — quoted in CAD against catalog prices.
  let customerId: string | null = null;
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const { data } = await supabase.auth.getUser(authHeader.slice('Bearer '.length));
      customerId = data.user?.id ?? null;
    } catch {
      customerId = null;
    }
  }

  let pricing;
  try {
    pricing = await priceCheckoutLines(db, customerId, lines);
  } catch {
    return NextResponse.json(
      { error: 'Could not load products. Please try again.' },
      { status: 500 },
    );
  }

  // Declared value per line, for customs and insurance — the customer's own
  // prices, restated in the dollars Easyship is asked to quote in (CAD).
  const rateItems = declaredValueItems(pricing);

  const options = await getPuramassShippingOptions(
    db,
    {
      address: typeof dest.line1 === 'string' ? dest.line1 : undefined,
      city: typeof dest.city === 'string' ? dest.city : undefined,
      state: typeof dest.state === 'string' ? dest.state : undefined,
      postalCode,
      country: typeof dest.country === 'string' ? dest.country : 'CA',
    },
    rateItems,
    { currency: pricing.currency, rate: pricing.rate },
  );

  return NextResponse.json({
    rates: options,
    currency: pricing.currency,
    // True when no courier could be quoted for this address — the checkout says
    // so instead of showing a made-up figure or letting the order through.
    unavailable: options.length === 0,
  });
}
