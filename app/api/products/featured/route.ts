import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeCoa<T extends { coa_url?: unknown }>(p: T): T & { coa_url: string[] } {
  const coa_url = Array.isArray(p.coa_url)
    ? p.coa_url.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
  return { ...p, coa_url };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const customerId = searchParams.get('customer_id');

    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, slug, description_short, price, vial_price, purity, strength, image_url, box_image_url, box_image_first, coa_url, stock_quantity')
      .eq('active', true)
      .eq('featured', true)
      // Out-of-stock featured products should not surface on the home page.
      .gt('stock_quantity', 0)
      .order('name')
      .limit(8);

    if (error) {
      console.error('Error fetching featured products:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!customerId) {
      return NextResponse.json({ products: (products ?? []).map(normalizeCoa) });
    }

    const { data: overrides, error: overridesError } = await supabase
      .from('customer_price_overrides')
      .select('product_id, override_price, vial_override_price, is_visible')
      .eq('customer_id', customerId);

    if (overridesError) {
      console.error('Error fetching price overrides:', overridesError);
      return NextResponse.json({ products: (products ?? []).map(normalizeCoa) });
    }

    // Products this customer should not see: those explicitly hidden (status
    // set to false) OR priced at $0 for this customer (a $0 custom price means
    // "don't show it").
    const hiddenIds = new Set(
      (overrides ?? [])
        .filter((o) => o.is_visible === false || Number(o.override_price) === 0)
        .map((o) => o.product_id)
    );

    const overrideMap = new Map(
      (overrides ?? [])
        .filter((o) => o.override_price != null)
        .map((o) => [o.product_id, o.override_price])
    );

    // Per-vial overrides replace the catalog vial_price for this customer.
    const vialOverrideMap = new Map(
      (overrides ?? [])
        .filter((o) => o.vial_override_price != null)
        .map((o) => [o.product_id, o.vial_override_price])
    );

    const productsWithPricing = (products ?? [])
      .filter((product) => !hiddenIds.has(product.id))
      .map((product) => {
        const normalized = normalizeCoa(product);
        const overridePrice = overrideMap.get(product.id);
        const vialOverride = vialOverrideMap.get(product.id);
        return {
          ...normalized,
          price: overridePrice !== undefined ? overridePrice : normalized.price,
          vial_price: vialOverride !== undefined ? vialOverride : normalized.vial_price,
          has_override: overridePrice !== undefined || vialOverride !== undefined,
          original_price: overridePrice !== undefined ? normalized.price : undefined,
          original_vial_price: vialOverride !== undefined ? normalized.vial_price : undefined,
        };
      });

    return NextResponse.json({ products: productsWithPricing });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
