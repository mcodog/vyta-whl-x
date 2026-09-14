import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Public: list active storefront categories, ordered for display. Drives the
// /products filter bar and (with ?featured=1) the homepage "Browse by
// Application" grid.
export async function GET(request: NextRequest) {
  try {
    const featuredOnly =
      request.nextUrl.searchParams.get('featured') === '1' ||
      request.nextUrl.searchParams.get('featured') === 'true';

    let query = supabase
      .from('store_categories')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (featuredOnly) query = query.eq('featured', true);

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching categories:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ categories: data ?? [] });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
