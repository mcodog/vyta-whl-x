import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canCreate } from '@/lib/permissions';
import { recordProductChanges } from '@/lib/admin/product-history';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper function to verify admin role
async function verifyAdminRole(request: NextRequest, requireMutation: boolean = false) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return { authorized: false, role: 'customer' as const, userId: null };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { authorized: false, role: 'customer' as const, userId: null };
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .single();

    const role = customer?.role || 'customer';

    if (requireMutation && !canCreate(role)) {
      return { authorized: false, role, userId: user.id };
    }

    // For read operations, allow admin and assistant, plus affiliates and
    // analytics accounts — the products catalog is readable by both (their
    // mutations are gated separately: affiliates can't mutate at all, analytics
    // may edit descriptor fields only via the [id] PUT route).
    if (
      !requireMutation &&
      (role === 'admin' || role === 'assistant' || role === 'affiliate' || role === 'analytics')
    ) {
      return { authorized: true, role, userId: user.id };
    }

    return { authorized: role === 'admin', role, userId: user.id };
  } catch (error) {
    console.error('Error verifying admin role:', error);
    return { authorized: false, role: 'customer' as const, userId: null };
  }
}

// GET: List all products with optional filters
export async function GET(request: NextRequest) {
  const { authorized } = await verifyAdminRole(request);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const active = searchParams.get('active');
    const category = searchParams.get('category');
    const featured = searchParams.get('featured');

    let query = supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (active !== null) {
      query = query.eq('active', active === 'true');
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (featured !== null) {
      query = query.eq('featured', featured === 'true');
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching products:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ products: data });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: Create a new product
export async function POST(request: NextRequest) {
  const { authorized, userId } = await verifyAdminRole(request, true);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      name,
      description,
      price,
      price_usd,
      vial_price,
      stock_quantity,
      vials_per_box,
      low_stock_threshold,
      category,
      image_url,
      box_image_url,
      box_image_first,
      strength,
      purity,
      form,
      featured,
      active,
      is_checkout_addon,
      slug,
      description_short,
      benefits,
      mechanism,
      coa_url,
    } = body;

    // Validate required fields
    if (!name || price === undefined || stock_quantity === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: name, price, stock_quantity' },
        { status: 400 }
      );
    }

    if (price < 0 || stock_quantity < 0) {
      return NextResponse.json(
        { error: 'Price and stock quantity must be non-negative' },
        { status: 400 }
      );
    }

    // Generate slug if not provided
    const productSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // Check if slug already exists
    const { data: existingProduct } = await supabase
      .from('products')
      .select('id')
      .eq('slug', productSlug)
      .single();

    if (existingProduct) {
      return NextResponse.json(
        { error: 'A product with this slug already exists' },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from('products')
      .insert({
        name,
        description,
        price,
        // Optional explicit USD price. When omitted, the USD price is computed
        // live from price × usd_exchange_rate (see lib/pricing.ts).
        price_usd:
          typeof price_usd === 'number' && price_usd >= 0 ? price_usd : null,
        vial_price:
          typeof vial_price === 'number' && vial_price >= 0 ? vial_price : null,
        stock_quantity,
        vials_per_box:
          typeof vials_per_box === 'number' && Number.isInteger(vials_per_box) && vials_per_box >= 1
            ? vials_per_box
            : 10,
        low_stock_threshold:
          typeof low_stock_threshold === 'number' && low_stock_threshold >= 0
            ? low_stock_threshold
            : 10,
        category,
        image_url,
        box_image_url,
        box_image_first: box_image_first || false,
        strength,
        purity,
        form,
        featured: featured || false,
        active: active !== undefined ? active : true,
        is_checkout_addon: is_checkout_addon || false,
        slug: productSlug,
        description_short,
        benefits,
        mechanism,
        coa_url: Array.isArray(coa_url)
          ? coa_url.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
          : [],
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating product:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Seed the price & stock history with the product's initial values.
    await recordProductChanges(supabase, {
      productId: data.id,
      actorId: userId,
      source: 'create',
      after: { price: data.price, price_usd: data.price_usd, stock_quantity: data.stock_quantity, vial_price: data.vial_price },
    });

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'product.create',
      entity_type: 'product',
      entity_id: data.id,
      payload: { name: data.name, slug: data.slug },
    });

    return NextResponse.json({ product: data }, { status: 201 });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'products',
      route: '/api/admin/products',
      method: 'POST',
      error,
      actor_id: userId,
    });
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
