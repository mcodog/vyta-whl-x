import { NextResponse } from 'next/server';
import {
  getEasyshipRates,
  getShippingQuoteOrFallback,
  type ShippingRateItem,
} from '@/lib/shipping/easyship';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Returns the available Easyship rates for the destination + cart (cheapest
 * first), or a single flat-rate fallback when Easyship is unavailable. Used by
 * the checkout to show shipping options before the order is placed.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`shipping-rates:${ip}`, RATE_LIMITS.general);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { destination, items } = body || {};

  if (!destination?.postalCode || !destination?.country) {
    return NextResponse.json(
      { error: 'Destination postal code and country are required' },
      { status: 400 },
    );
  }

  const rateItems: ShippingRateItem[] = Array.isArray(items)
    ? items.map((it: any) => ({
        quantity: Number(it.quantity) || 1,
        declaredValue: Number(it.price) * (Number(it.quantity) || 1) || 0,
      }))
    : [];

  const rates = await getEasyshipRates(destination, rateItems);
  if (rates.length > 0) {
    return NextResponse.json({ rates, estimated: false });
  }

  // No live rates — return the flat fallback as a single, non-selectable rate.
  const fallback = await getShippingQuoteOrFallback(destination, rateItems);
  return NextResponse.json({
    rates: [
      {
        courierId: '',
        courier: fallback.courier,
        cost: fallback.cost,
        currency: fallback.currency,
      },
    ],
    estimated: true,
  });
}
