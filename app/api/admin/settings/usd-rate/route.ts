import { NextResponse } from 'next/server';

/**
 * Fetch the current live CAD→USD exchange rate.
 *
 * Best-effort helper for the Site Settings "Live rate" button — it does NOT
 * persist anything; the admin reviews the returned rate and saves it via the
 * normal settings PUT. Uses a couple of free, key-less FX endpoints with a
 * fallback so a single provider hiccup doesn't break the button.
 */
export const dynamic = 'force-dynamic';

type RateFetcher = () => Promise<number | null>;

const SOURCES: RateFetcher[] = [
  // open.er-api.com — { rates: { USD: 0.73, ... } }
  async () => {
    const res = await fetch('https://open.er-api.com/v6/latest/CAD', {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const usd = data?.rates?.USD;
    return typeof usd === 'number' && usd > 0 ? usd : null;
  },
  // exchangerate.host — { rates: { USD: 0.73 } }
  async () => {
    const res = await fetch(
      'https://api.exchangerate.host/latest?base=CAD&symbols=USD',
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const usd = data?.rates?.USD;
    return typeof usd === 'number' && usd > 0 ? usd : null;
  },
];

export async function GET() {
  for (const fetchRate of SOURCES) {
    try {
      const rate = await fetchRate();
      if (rate && Number.isFinite(rate) && rate > 0) {
        // Round to 4 dp — plenty for a price multiplier.
        return NextResponse.json({ rate: Math.round(rate * 10000) / 10000 });
      }
    } catch {
      // Try the next source.
    }
  }
  return NextResponse.json(
    { error: 'Could not fetch a live CAD→USD rate right now. Enter it manually.' },
    { status: 502 },
  );
}
