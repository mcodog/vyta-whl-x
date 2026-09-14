import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Verify the caller is an admin/assistant (read access).
async function verifyAdminRole(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return false;

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return false;

    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .single();

    const role = customer?.role || 'customer';
    return role === 'admin' || role === 'assistant';
  } catch (error) {
    console.error('Error verifying admin role:', error);
    return false;
  }
}

interface ProductRef {
  name: string | null;
  slug: string | null;
  image_url: string | null;
  price: number | null;
  stock_quantity: number | null;
}

/**
 * GET /api/admin/stock-notifications
 * Returns products with pending "notify me" requests, aggregated by product
 * and sorted by the number of waiting customers (most-requested first).
 */
export async function GET(request: NextRequest) {
  if (!(await verifyAdminRole(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    // When a product_id is supplied, return that product's pending waitlist
    // (used by the admin restock confirmation dialog).
    const productId = request.nextUrl.searchParams.get('product_id');
    if (productId) {
      const { data: rows, error: listError } = await supabase
        .from('stock_notifications')
        .select('email, created_at')
        .eq('product_id', productId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (listError) {
        console.error('Error fetching product waitlist:', listError);
        return NextResponse.json({ error: listError.message }, { status: 500 });
      }

      const emails = (rows ?? []).map((r) => r.email);
      return NextResponse.json({ emails, count: emails.length });
    }

    const { data, error } = await supabase
      .from('stock_notifications')
      .select('product_id, email, created_at, product:products(name, slug, image_url, price, stock_quantity)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching stock notifications:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Aggregate per product in memory.
    const byProduct = new Map<
      string,
      {
        product_id: string;
        name: string | null;
        slug: string | null;
        image_url: string | null;
        price: number | null;
        stock_quantity: number | null;
        count: number;
        latest_request: string;
      }
    >();

    for (const row of data ?? []) {
      const product = (row.product as ProductRef | null) ?? null;
      const existing = byProduct.get(row.product_id);
      if (existing) {
        existing.count += 1;
        if (row.created_at > existing.latest_request) existing.latest_request = row.created_at;
      } else {
        byProduct.set(row.product_id, {
          product_id: row.product_id,
          name: product?.name ?? null,
          slug: product?.slug ?? null,
          image_url: product?.image_url ?? null,
          price: product?.price ?? null,
          stock_quantity: product?.stock_quantity ?? null,
          count: 1,
          latest_request: row.created_at,
        });
      }
    }

    const products = Array.from(byProduct.values()).sort((a, b) => b.count - a.count);
    const totalRequests = (data ?? []).length;

    return NextResponse.json({ products, totalRequests });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
