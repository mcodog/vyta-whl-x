import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canManageCategories, type UserRole } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Resolve the caller's role. Reads are open to admin/assistant; mutations are
// gated per-handler with canCreate / canEdit (admin-only).
async function resolveRole(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return { role: 'customer' as UserRole, userId: null };
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { role: 'customer' as UserRole, userId: null };
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .single();
  return { role: (customer?.role || 'customer') as UserRole, userId: user.id };
}

// GET: list every category (including inactive), ordered for the admin table.
export async function GET(request: NextRequest) {
  const { role } = await resolveRole(request);
  if (role !== 'admin' && role !== 'assistant' && role !== 'analytics') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('store_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('Error listing categories:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ categories: data ?? [] });
}

// POST: create a category. slug is required and immutable thereafter.
export async function POST(request: NextRequest) {
  const { role, userId } = await resolveRole(request);
  if (!canManageCategories(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!slug || !name) {
      return NextResponse.json({ error: 'slug and name are required' }, { status: 400 });
    }

    // Place new categories at the end by default.
    const { data: last } = await supabase
      .from('store_categories')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort =
      typeof body.sort_order === 'number' ? body.sort_order : (last?.sort_order ?? 0) + 1;

    const { data, error } = await supabase
      .from('store_categories')
      .insert({
        slug,
        name,
        home_label: body.home_label?.trim() || null,
        description: body.description?.trim() || null,
        icon: typeof body.icon === 'string' && body.icon ? body.icon : 'Beaker',
        sort_order: nextSort,
        active: body.active !== undefined ? !!body.active : true,
        featured: !!body.featured,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation (duplicate slug).
      const status = (error as { code?: string }).code === '23505' ? 409 : 500;
      const message =
        status === 409 ? 'A category with this slug already exists' : error.message;
      return NextResponse.json({ error: message }, { status });
    }

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'category.create',
      entity_type: 'store_category',
      entity_id: data.id,
      payload: { slug: data.slug, name: data.name },
    }).catch((err) => console.error('Error writing audit log:', err));

    return NextResponse.json({ category: data }, { status: 201 });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'categories',
      route: '/api/admin/categories',
      method: 'POST',
      error,
      actor_id: userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT: persist a new ordering. Body: { order: string[] } — category ids in the
// desired order; sort_order is rewritten to the array index (1-based).
export async function PUT(request: NextRequest) {
  const { role, userId } = await resolveRole(request);
  if (!canManageCategories(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const order: unknown = body.order;
    if (!Array.isArray(order) || order.some((id) => typeof id !== 'string')) {
      return NextResponse.json({ error: 'order must be an array of category ids' }, { status: 400 });
    }

    // Update each row's sort_order to match its position. Awaited together so the
    // whole reorder is persisted before the response returns.
    const results = await Promise.all(
      (order as string[]).map((id, index) =>
        supabase
          .from('store_categories')
          .update({ sort_order: index + 1, updated_at: new Date().toISOString() })
          .eq('id', id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      return NextResponse.json({ error: failed.error.message }, { status: 500 });
    }

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'category.reorder',
      entity_type: 'store_category',
      entity_id: null,
      payload: { count: order.length },
    }).catch((err) => console.error('Error writing audit log:', err));

    return NextResponse.json({ success: true });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'categories',
      route: '/api/admin/categories',
      method: 'PUT',
      error,
      actor_id: userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
