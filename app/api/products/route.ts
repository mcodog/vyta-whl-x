import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Product columns that must never reach the storefront. `grid_note` is the
 * operator's internal scratch note from the admin cell-edit grid ("waiting on
 * Jason", "check lot 24-B") — it is not product copy and is nobody's business
 * outside the admin.
 */
const PUBLIC_HIDDEN_PRODUCT_FIELDS = ['grid_note'] as const;

/** Drop the internal-only columns from one product row. */
function stripInternal<T>(product: T): T {
  if (!product || typeof product !== 'object') return product;
  const out = { ...(product as Record<string, unknown>) };
  for (const field of PUBLIC_HIDDEN_PRODUCT_FIELDS) delete out[field];
  return out as T;
}

/**
 * The same, over whatever the query returned — a single row when `slug` was
 * given, an array otherwise, or null when nothing matched.
 */
function publicProducts<T>(products: T): T {
  if (Array.isArray(products)) return products.map(stripInternal) as T;
  return stripInternal(products);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const customerId = searchParams.get('customer_id');
    const slug = searchParams.get('slug');
    const category = searchParams.get('category');
    // When set, return only products flagged as checkout/cart upsell add-ons.
    const addon = searchParams.get('addon');

    let query = supabase
      .from('products')
      .select('*')
      .eq('active', true);
    // NOTE: `select('*')` means every new products column lands in this public
    // payload by default. Anything internal has to be stripped on the way out —
    // see PUBLIC_HIDDEN_PRODUCT_FIELDS / stripInternal below.

    // Filter by slug if provided (for single product)
    if (slug) {
      query = query.eq('slug', slug).single();
    }

    // Filter by category if provided
    if (category && category !== 'All') {
      query = query.eq('category', category);
    }

    // Restrict to checkout add-ons (e.g. bacteriostatic water) when requested.
    if (addon === '1' || addon === 'true') {
      query = query.eq('is_checkout_addon', true);
    }

    // Order by name
    if (!slug) {
      query = query.order('name');
    }

    const { data: products, error } = await query;

    if (error) {
      console.error('Error fetching products:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If no customer ID provided, return products with default prices
    if (!customerId) {
      return NextResponse.json({ products: publicProducts(products) });
    }

    // Fetch price overrides for this customer
    const { data: overrides, error: overridesError } = await supabase
      .from('customer_price_overrides')
      .select('product_id, override_price, vial_override_price, is_visible')
      .eq('customer_id', customerId);

    if (overridesError) {
      console.error('Error fetching price overrides:', overridesError);
      // Continue with default prices if override fetch fails
      return NextResponse.json({ products: publicProducts(products) });
    }

    // Products this customer should not see: those explicitly hidden (status
    // set to false) OR priced at $0 for this customer (a $0 custom price means
    // "don't show it").
    const hiddenIds = new Set(
      (overrides ?? [])
        .filter((o) => o.is_visible === false || Number(o.override_price) === 0)
        .map((o) => o.product_id)
    );

    // Create a map of product_id -> override_price for quick lookup. Rows that
    // only carry a visibility flag (no custom price) have a null override_price
    // and are skipped here.
    const overrideMap = new Map(
      (overrides ?? [])
        .filter((o) => o.override_price != null)
        .map((o) => [o.product_id, o.override_price])
    );

    // Per-vial overrides: product_id -> vial_override_price. When set, the
    // customer's single-vial price replaces the catalog products.vial_price so
    // the storefront shows the vial price configured for them.
    const vialOverrideMap = new Map(
      (overrides ?? [])
        .filter((o) => o.vial_override_price != null)
        .map((o) => [o.product_id, o.vial_override_price])
    );

    // Layer the customer's box + vial overrides onto a catalog product.
    const applyOverride = (product: any) => {
      const overridePrice = overrideMap.get(product.id);
      const vialOverride = vialOverrideMap.get(product.id);
      return {
        ...stripInternal(product),
        price: overridePrice !== undefined ? overridePrice : product.price,
        vial_price: vialOverride !== undefined ? vialOverride : product.vial_price,
        has_override: overridePrice !== undefined || vialOverride !== undefined,
        original_price: overridePrice !== undefined ? product.price : undefined,
        original_vial_price: vialOverride !== undefined ? product.vial_price : undefined,
      };
    };

    // Apply price overrides
    let productsWithPricing;
    if (slug) {
      // Single product — hidden for this customer means "not found".
      const product = products as any;
      if (hiddenIds.has(product.id)) {
        return NextResponse.json({ products: null });
      }
      productsWithPricing = applyOverride(product);
    } else {
      // Multiple products — drop the ones hidden for this customer.
      productsWithPricing = (products as any[])
        .filter((product) => !hiddenIds.has(product.id))
        .map(applyOverride);
    }

    return NextResponse.json({ products: productsWithPricing });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
