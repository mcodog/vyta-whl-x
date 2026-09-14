import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readSiteConfigRow } from '@/lib/site-config';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Public: storefront branding + tracking config (no secrets). Consumed by the
// site header/footer, page metadata, and the tracking/consent component.
export async function GET() {
  const config = await readSiteConfigRow(supabase);
  return NextResponse.json(config);
}
