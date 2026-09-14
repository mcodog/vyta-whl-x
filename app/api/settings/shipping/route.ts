import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

/**
 * Public storefront shipping settings.
 *
 * Returns the admin-configured free-shipping threshold (CAD-base subtotal) so
 * client pages can render the "spend $X more for free shipping" progress bar.
 * Read-only and exposes only the threshold — no other site settings. Falls back
 * to 0 (feature off) if the column/table isn't available yet.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getSupabase();
    const { data } = await db
      .from('site_settings')
      .select('free_shipping_threshold')
      .maybeSingle();

    const n = Number(data?.free_shipping_threshold);
    return NextResponse.json({
      free_shipping_threshold: Number.isFinite(n) && n > 0 ? n : 0,
    });
  } catch {
    return NextResponse.json({ free_shipping_threshold: 0 });
  }
}
