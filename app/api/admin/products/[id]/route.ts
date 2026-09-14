import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  canDelete,
  canEditProductDescriptors,
  PRODUCT_DESCRIPTOR_FIELDS,
  type UserRole,
} from '@/lib/permissions';
import { sendBackInStockNotification } from '@/lib/email-smtp';
import { checkLowStockForProducts } from '@/lib/admin/low-stock';
import { recordProductChanges, type ProductChangeSource } from '@/lib/admin/product-history';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Resolve the caller's role from the bearer token.
//
// `requireMutation` gates on who may write a product at all: admins (full edit)
// plus analytics accounts (descriptor-only — the PUT handler strips everything
// else). DELETE additionally checks canDelete(role), so analytics can't delete.
// Reads are allowed for admin, assistant, and analytics accounts.
async function verifyAdminRole(request: NextRequest, requireMutation: boolean = false) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return { authorized: false, role: 'customer' as UserRole, userId: null };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { authorized: false, role: 'customer' as UserRole, userId: null };
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .single();

    const role = (customer?.role || 'customer') as UserRole;

    if (requireMutation) {
      // Admins and analytics accounts may write; the PUT handler decides which
      // fields analytics is allowed to touch.
      return { authorized: canEditProductDescriptors(role), role, userId: user.id };
    }

    // Reads: admin, assistant, and analytics accounts.
    const canRead = role === 'admin' || role === 'assistant' || role === 'analytics';
    return { authorized: canRead, role, userId: user.id };
  } catch (error) {
    console.error('Error verifying admin role:', error);
    return { authorized: false, role: 'customer' as UserRole, userId: null };
  }
}

/** Change sources a client is allowed to claim for a product edit. */
const CLIENT_CHANGE_SOURCES: ReadonlySet<ProductChangeSource> = new Set<ProductChangeSource>([
  'inline',
  'form',
  'import',
  'revert',
  'api',
  'cell-grid',
]);

/** Whitelist a client-supplied change_source, defaulting to 'form'. */
function normalizeChangeSource(raw: unknown): ProductChangeSource {
  return typeof raw === 'string' && CLIENT_CHANGE_SOURCES.has(raw as ProductChangeSource)
    ? (raw as ProductChangeSource)
    : 'form';
}

// GET: Get a single product by ID
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { authorized } = await verifyAdminRole(request);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', params.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      }
      console.error('Error fetching product:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ product: data });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT: Update a product
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { authorized, role, userId } = await verifyAdminRole(request, true);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  // Analytics accounts may edit descriptor/content fields only. Anything else
  // (price/stock/pricing/visibility) is silently ignored for them — the UI hides
  // those inputs, and this is the authoritative server-side guard.
  const descriptorsOnly = role !== 'admin';

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
      grid_note,
      change_source,
    } = body;

    // Validate if product exists
    const { data: existingProduct, error: fetchError } = await supabase
      .from('products')
      .select('id, slug, price, price_usd, vial_price, stock_quantity')
      .eq('id', params.id)
      .single();

    if (fetchError || !existingProduct) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Validate numeric fields if provided
    if (price !== undefined && price < 0) {
      return NextResponse.json({ error: 'Price must be non-negative' }, { status: 400 });
    }

    if (
      price_usd !== undefined &&
      price_usd !== null &&
      (typeof price_usd !== 'number' || price_usd < 0)
    ) {
      return NextResponse.json({ error: 'USD price must be a non-negative number' }, { status: 400 });
    }

    if (
      vial_price !== undefined &&
      vial_price !== null &&
      (typeof vial_price !== 'number' || vial_price < 0)
    ) {
      return NextResponse.json({ error: 'Vial price must be a non-negative number' }, { status: 400 });
    }

    if (stock_quantity !== undefined && stock_quantity < 0) {
      return NextResponse.json({ error: 'Stock quantity must be non-negative' }, { status: 400 });
    }

    if (
      vials_per_box !== undefined &&
      (typeof vials_per_box !== 'number' || !Number.isInteger(vials_per_box) || vials_per_box < 1)
    ) {
      return NextResponse.json({ error: 'Vials per box must be a whole number of at least 1' }, { status: 400 });
    }

    if (
      low_stock_threshold !== undefined &&
      low_stock_threshold !== null &&
      (typeof low_stock_threshold !== 'number' || low_stock_threshold < 0)
    ) {
      return NextResponse.json({ error: 'Low stock threshold must be a non-negative number' }, { status: 400 });
    }

    // Check if slug is being changed and if it conflicts
    if (slug && slug !== existingProduct.slug) {
      const { data: conflictingProduct } = await supabase
        .from('products')
        .select('id')
        .eq('slug', slug)
        .neq('id', params.id)
        .single();

      if (conflictingProduct) {
        return NextResponse.json(
          { error: 'A product with this slug already exists' },
          { status: 409 }
        );
      }
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price;
    if (price_usd !== undefined) updateData.price_usd = price_usd;
    if (vial_price !== undefined) updateData.vial_price = vial_price;
    if (stock_quantity !== undefined) updateData.stock_quantity = stock_quantity;
    if (vials_per_box !== undefined) updateData.vials_per_box = vials_per_box;
    if (low_stock_threshold !== undefined) updateData.low_stock_threshold = low_stock_threshold;
    if (category !== undefined) updateData.category = category;
    if (image_url !== undefined) updateData.image_url = image_url;
    if (box_image_url !== undefined) updateData.box_image_url = box_image_url;
    if (box_image_first !== undefined) updateData.box_image_first = box_image_first;
    if (strength !== undefined) updateData.strength = strength;
    if (purity !== undefined) updateData.purity = purity;
    if (form !== undefined) updateData.form = form;
    if (featured !== undefined) updateData.featured = featured;
    if (active !== undefined) updateData.active = active;
    if (is_checkout_addon !== undefined) updateData.is_checkout_addon = is_checkout_addon;
    if (slug !== undefined) updateData.slug = slug;
    if (description_short !== undefined) updateData.description_short = description_short;
    if (benefits !== undefined) updateData.benefits = benefits;
    if (mechanism !== undefined) updateData.mechanism = mechanism;
    if (coa_url !== undefined) {
      updateData.coa_url = Array.isArray(coa_url)
        ? coa_url.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
        : [];
    }
    // Internal note typed in the cell-edit grid. Blank is stored as NULL so an
    // emptied note is indistinguishable from one that was never written, and
    // the length cap keeps a runaway paste out of the row.
    if (grid_note !== undefined) {
      const note = typeof grid_note === 'string' ? grid_note.trim().slice(0, 500) : '';
      updateData.grid_note = note || null;
    }

    // Authoritative descriptor-only guard for non-admin editors (analytics
    // accounts): drop any commerce/visibility keys they may have sent, keeping
    // only whitelisted descriptor fields (plus the updated_at bookkeeping key).
    if (descriptorsOnly) {
      const allowed = new Set<string>([...PRODUCT_DESCRIPTOR_FIELDS, 'updated_at']);
      for (const key of Object.keys(updateData)) {
        if (!allowed.has(key)) delete updateData[key];
      }
    }

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating product:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // The post-update side-effects (history, waitlist email, low-stock alerts,
    // audit log) are independent of each other, so run them concurrently rather
    // than serially — this is the bulk of the request's latency and dominates
    // how fast an inline edit feels. Each is still awaited (so it reliably
    // completes before the response returns on serverless) and wrapped so one
    // failure never fails the update or blocks the others.
    const wasOutOfStock = !existingProduct.stock_quantity || existingProduct.stock_quantity <= 0;
    const isNowInStock = typeof data.stock_quantity === 'number' && data.stock_quantity > 0;

    await Promise.all([
      // Record price / stock changes for the history timeline. Only the fields
      // present in the request are compared, so a price-only edit won't log a
      // spurious stock entry.
      recordProductChanges(supabase, {
        productId: params.id,
        actorId: userId,
        source: normalizeChangeSource(change_source),
        before: {
          price: existingProduct.price,
          price_usd: existingProduct.price_usd,
          stock_quantity: existingProduct.stock_quantity,
          vial_price: existingProduct.vial_price,
        },
        after: {
          ...(price !== undefined ? { price: data.price } : {}),
          ...(price_usd !== undefined ? { price_usd: data.price_usd } : {}),
          ...(stock_quantity !== undefined ? { stock_quantity: data.stock_quantity } : {}),
          ...(vial_price !== undefined ? { vial_price: data.vial_price } : {}),
        },
      }).catch((err) => console.error('Error recording product history:', err)),

      // Detect a restock (0 -> positive) and notify everyone on the waitlist.
      wasOutOfStock && isNowInStock
        ? notifyWaitlist(params.id, data).catch((err) =>
            console.error('Error notifying stock waitlist:', err),
          )
        : Promise.resolve(),

      // Re-evaluate low-stock alerts after a manual stock/threshold edit. Fires
      // an admin email once per crossing and re-arms when stock recovers.
      checkLowStockForProducts(supabase, [params.id]).catch((err) =>
        console.error('Error checking low stock:', err),
      ),

      // Audit log.
      logAuditServer(supabase, {
        actor_id: userId,
        action: 'product.update',
        entity_type: 'product',
        entity_id: params.id,
        payload: { name: data.name, slug: data.slug },
      }).catch((err) => console.error('Error writing audit log:', err)),
    ]);

    return NextResponse.json({ product: data });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'products',
      route: '/api/admin/products/[id]',
      method: 'PUT',
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

// Email all pending "notify me" subscribers for a restocked product and mark
// their requests as notified. Best-effort: individual email failures are logged
// but do not block the others.
async function notifyWaitlist(productId: string, product: any) {
  const { data: requests, error } = await supabase
    .from('stock_notifications')
    .select('id, email')
    .eq('product_id', productId)
    .eq('status', 'pending');

  if (error) {
    console.error('Error loading stock waitlist:', error);
    return;
  }
  if (!requests || requests.length === 0) return;

  const notifiedIds: string[] = [];
  for (const req of requests) {
    const result = await sendBackInStockNotification({
      to: req.email,
      productName: product.name,
      productSlug: product.slug,
      imageUrl: product.image_url,
      strength: product.strength,
      price: product.price,
    });
    if (result.success) notifiedIds.push(req.id);
  }

  if (notifiedIds.length > 0) {
    await supabase
      .from('stock_notifications')
      .update({ status: 'notified', notified_at: new Date().toISOString() })
      .in('id', notifiedIds);
  }
}

// DELETE: Delete a product
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { authorized, role, userId } = await verifyAdminRole(request, true);

  if (!authorized || !canDelete(role)) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    // Check if product exists
    const { data: existingProduct, error: fetchError } = await supabase
      .from('products')
      .select('id, name')
      .eq('id', params.id)
      .single();

    if (fetchError || !existingProduct) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', params.id);

    if (error) {
      console.error('Error deleting product:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'product.delete',
      entity_type: 'product',
      entity_id: params.id,
      payload: { name: existingProduct.name },
    });

    return NextResponse.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'products',
      route: '/api/admin/products/[id]',
      method: 'DELETE',
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

/**
 * The cell-edit grid PATCHes each dirty row with only the columns that changed.
 * PUT already treats every field as optional, so PATCH is the same handler
 * under its more accurate verb.
 */
export const PATCH = PUT;
