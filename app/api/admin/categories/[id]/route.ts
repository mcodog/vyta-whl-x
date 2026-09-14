import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canManageCategories, type UserRole } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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

// PUT: update a category's editable fields. `slug` is the stable key that links
// categories to products.category, so it is intentionally NOT updatable here.
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { role, userId } = await resolveRole(request);
  if (!canManageCategories(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
      updateData.name = name;
    }
    if (body.home_label !== undefined) updateData.home_label = body.home_label?.trim() || null;
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.icon !== undefined) updateData.icon = typeof body.icon === 'string' && body.icon ? body.icon : 'Beaker';
    if (body.sort_order !== undefined && typeof body.sort_order === 'number') updateData.sort_order = body.sort_order;
    if (body.active !== undefined) updateData.active = !!body.active;
    if (body.featured !== undefined) updateData.featured = !!body.featured;

    const { data, error } = await supabase
      .from('store_categories')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'category.update',
      entity_type: 'store_category',
      entity_id: params.id,
      payload: { slug: data.slug, name: data.name },
    });

    return NextResponse.json({ category: data });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'categories',
      route: '/api/admin/categories/[id]',
      method: 'PUT',
      error,
      actor_id: userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE: remove a category. Products keep their `category` string value; the
// category simply stops appearing in the filter/homepage. Admin-only.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { role, userId } = await resolveRole(request);
  if (!canManageCategories(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { data: existing } = await supabase
      .from('store_categories')
      .select('id, slug, name')
      .eq('id', params.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    const { error } = await supabase.from('store_categories').delete().eq('id', params.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'category.delete',
      entity_type: 'store_category',
      entity_id: params.id,
      payload: { slug: existing.slug, name: existing.name },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'categories',
      route: '/api/admin/categories/[id]',
      method: 'DELETE',
      error,
      actor_id: userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
