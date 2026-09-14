import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';
import { syncAffiliatePriceListFromOwnRecord } from '@/lib/admin/affiliate-pricelist-sync';
import { markCustomerDedicated } from '@/lib/admin/pricing-mode';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getCaller(request: NextRequest): Promise<{ id: string; role: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  return { id: user.id, role: customer?.role || 'customer' };
}

// Bound customer ids for an affiliate (used to scope overrides).
async function boundCustomerIds(affiliateId: string): Promise<string[]> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .eq('affiliate_id', affiliateId);
  return (data ?? []).map((c) => c.id);
}

// Whether the affiliate is allowed to manage overrides for this customer.
async function affiliateOwnsCustomer(affiliateId: string, customerId: string): Promise<boolean> {
  const { data } = await supabase
    .from('customers')
    .select('affiliate_id')
    .eq('id', customerId)
    .maybeSingle();
  return data?.affiliate_id === affiliateId;
}

// GET: List price overrides (scoped to bound customers for affiliates)
export async function GET(request: NextRequest) {
  try {
    const caller = await getCaller(request);
    if (!caller || caller.role === 'customer') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const customerId = searchParams.get('customer_id');
    const productId = searchParams.get('product_id');

    let query = supabase
      .from('customer_price_overrides')
      .select(`
        id,
        customer_id,
        product_id,
        override_price,
        unlabeled_override_price,
        vial_override_price,
        is_visible,
        created_at,
        updated_at,
        customers(id, first_name, last_name, email),
        products(id, name, slug, price)
      `)
      .order('created_at', { ascending: false });

    if (caller.role === 'affiliate') {
      const ids = await boundCustomerIds(caller.id);
      if (ids.length === 0) return NextResponse.json({ overrides: [] });
      query = query.in('customer_id', ids);
    }

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }

    if (productId) {
      query = query.eq('product_id', productId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching price overrides:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ overrides: data });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: Create a new price override
export async function POST(request: NextRequest) {
  let callerId: string | null = null;
  try {
    const caller = await getCaller(request);
    if (!caller || (caller.role !== 'admin' && caller.role !== 'affiliate')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    callerId = caller.id;

    const body = await request.json();
    const { customer_id, product_id, override_price, unlabeled_override_price, vial_override_price, is_visible } = body;

    // A row can carry a price override, a visibility override, or both — so at
    // least one of override_price / is_visible must be present.
    if (!customer_id || !product_id || (override_price === undefined && is_visible === undefined)) {
      return NextResponse.json(
        { error: 'Missing required fields: customer_id, product_id, and one of override_price / is_visible' },
        { status: 400 }
      );
    }

    if (override_price != null && override_price < 0) {
      return NextResponse.json(
        { error: 'override_price must be non-negative' },
        { status: 400 }
      );
    }

    if (is_visible !== undefined && typeof is_visible !== 'boolean') {
      return NextResponse.json(
        { error: 'is_visible must be a boolean' },
        { status: 400 }
      );
    }

    if (unlabeled_override_price != null && unlabeled_override_price < 0) {
      return NextResponse.json(
        { error: 'unlabeled_override_price must be non-negative' },
        { status: 400 }
      );
    }

    if (vial_override_price != null && vial_override_price < 0) {
      return NextResponse.json(
        { error: 'vial_override_price must be non-negative' },
        { status: 400 }
      );
    }

    // Affiliates may only set prices for their own bound customers.
    if (caller.role === 'affiliate' && !(await affiliateOwnsCustomer(caller.id, customer_id))) {
      return NextResponse.json({ error: 'Customer not in your account' }, { status: 403 });
    }

    // Verify customer exists
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('id', customer_id)
      .single();

    if (customerError || !customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    // Verify product exists
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, price')
      .eq('id', product_id)
      .single();

    if (productError || !product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    // Create or update the override (upsert). Only the columns present in the
    // payload are written, so a visibility-only toggle leaves the existing
    // price untouched, and a price-only edit leaves the visibility untouched.
    const { data, error } = await supabase
      .from('customer_price_overrides')
      .upsert(
        {
          customer_id,
          product_id,
          ...(override_price !== undefined ? { override_price } : {}),
          ...(unlabeled_override_price !== undefined
            ? { unlabeled_override_price }
            : {}),
          ...(vial_override_price !== undefined
            ? { vial_override_price }
            : {}),
          ...(is_visible !== undefined ? { is_visible } : {}),
        },
        {
          onConflict: 'customer_id,product_id',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error creating price override:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // A hand-set price is a deviation from any shared list → mark the customer
    // 'dedicated'. Visibility-only toggles carry no price and don't count.
    const hasPriceWrite =
      override_price !== undefined ||
      unlabeled_override_price !== undefined ||
      vial_override_price !== undefined;
    if (hasPriceWrite) await markCustomerDedicated(supabase, customer_id);

    // If this override belongs to an affiliate's own record, keep their price
    // list in sync (no-op for ordinary customers).
    await syncAffiliatePriceListFromOwnRecord(supabase, customer_id);

    await logAuditServer(supabase, {
      actor_id: callerId,
      action: 'price_override.update',
      entity_type: 'price_override',
      entity_id: data?.id ?? null,
      payload: { customer_id, product_id },
    });

    return NextResponse.json({ override: data }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    await logErrorServer(supabase, {
      area: 'price-overrides',
      route: '/api/admin/price-overrides',
      method: 'POST',
      error,
      actor_id: callerId,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE: Remove a price override
export async function DELETE(request: NextRequest) {
  let callerId: string | null = null;
  try {
    const caller = await getCaller(request);
    if (!caller || (caller.role !== 'admin' && caller.role !== 'affiliate')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    callerId = caller.id;

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const customerId = searchParams.get('customer_id');
    const productId = searchParams.get('product_id');

    // Resolve the affected customer (from the row when only an id was given) so
    // we can confirm affiliate ownership and re-sync that customer's price list
    // after the delete.
    let targetCustomer = customerId;
    if (!targetCustomer && id) {
      const { data: row } = await supabase
        .from('customer_price_overrides')
        .select('customer_id')
        .eq('id', id)
        .maybeSingle();
      targetCustomer = row?.customer_id ?? null;
    }

    // Affiliates may only delete overrides for their own bound customers.
    if (caller.role === 'affiliate') {
      if (!targetCustomer || !(await affiliateOwnsCustomer(caller.id, targetCustomer))) {
        return NextResponse.json({ error: 'Customer not in your account' }, { status: 403 });
      }
    }

    let query = supabase.from('customer_price_overrides').delete();

    if (id) {
      query = query.eq('id', id);
    } else if (customerId && productId) {
      query = query.eq('customer_id', customerId).eq('product_id', productId);
    } else {
      return NextResponse.json(
        { error: 'Must provide either id or both customer_id and product_id' },
        { status: 400 }
      );
    }

    const { error } = await query;

    if (error) {
      console.error('Error deleting price override:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Deleting a custom price is hand-management of this customer's list → mark
    // them 'dedicated' (only a re-apply of a shared list resets to 'template').
    if (targetCustomer) await markCustomerDedicated(supabase, targetCustomer);

    // Keep the affiliate's price list in sync when their own record changed
    // (no-op for ordinary customers).
    if (targetCustomer) await syncAffiliatePriceListFromOwnRecord(supabase, targetCustomer);

    await logAuditServer(supabase, {
      actor_id: callerId,
      action: 'price_override.delete',
      entity_type: 'price_override',
      entity_id: id ?? null,
      payload: { customer_id: customerId, product_id: productId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error:', error);
    await logErrorServer(supabase, {
      area: 'price-overrides',
      route: '/api/admin/price-overrides',
      method: 'DELETE',
      error,
      actor_id: callerId,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
