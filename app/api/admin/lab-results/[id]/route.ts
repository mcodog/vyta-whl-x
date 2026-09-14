import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyLabResultsAccess, sanitizeLabResult } from '@/lib/admin/lab-results';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PATCH: update a lab result (edit fields or toggle show/hide via `active`).
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { authorized, userId } = await verifyLabResultsAccess(supabase, request, true);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const { id } = params;
    const body = await request.json();
    const patch = sanitizeLabResult(body);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }
    if ('report_url' in patch && !patch.report_url) {
      return NextResponse.json({ error: 'report_url cannot be empty' }, { status: 400 });
    }
    if ('product_name' in patch && !patch.product_name) {
      return NextResponse.json({ error: 'product_name cannot be empty' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('lab_results')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      const message =
        error.code === '23505'
          ? 'A lab result with this report URL already exists'
          : error.message;
      return NextResponse.json({ error: message }, { status });
    }
    if (!data) {
      return NextResponse.json({ error: 'Lab result not found' }, { status: 404 });
    }

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'lab_result.update',
      entity_type: 'lab_result',
      entity_id: id,
      payload: { product_name: data.product_name },
    });

    return NextResponse.json({ labResult: data });
  } catch (e) {
    await logErrorServer(supabase, {
      area: 'lab-results',
      route: '/api/admin/lab-results/[id]',
      method: 'PATCH',
      error: e,
      actor_id: userId,
    });
    console.error('Unexpected error (lab-results PATCH):', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE: remove a lab result.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { authorized, userId } = await verifyLabResultsAccess(supabase, request, true);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const { id } = params;
    const { error } = await supabase.from('lab_results').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'lab_result.delete',
      entity_type: 'lab_result',
      entity_id: id,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    await logErrorServer(supabase, {
      area: 'lab-results',
      route: '/api/admin/lab-results/[id]',
      method: 'DELETE',
      error: e,
      actor_id: userId,
    });
    console.error('Unexpected error (lab-results DELETE):', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
