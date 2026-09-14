import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { DEFAULT_USD_RATE } from '@/lib/pricing';

/**
 * Public storefront currency settings.
 *
 * Returns the admin-configured CAD→USD multiplier so client pages can display
 * (and the checkout can charge) USD-tagged customers in USD. Read-only and
 * exposes only the exchange rate — no other site settings. Falls back to the
 * default rate if the column/table isn't available yet.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getSupabase();
    const { data } = await db
      .from('site_settings')
      .select('usd_exchange_rate')
      .maybeSingle();

    const rate = Number(data?.usd_exchange_rate);
    return NextResponse.json({
      usd_exchange_rate:
        Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_USD_RATE,
    });
  } catch {
    return NextResponse.json({ usd_exchange_rate: DEFAULT_USD_RATE });
  }
}
