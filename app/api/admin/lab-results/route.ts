import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyLabResultsAccess, sanitizeLabResult } from '@/lib/admin/lab-results';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET: all lab results (active + hidden) with the products each report covers.
export async function GET(request: NextRequest) {
  const { authorized } = await verifyLabResultsAccess(supabase, request);
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  try {
    const [{ data: labResults, error: labError }, { data: products, error: productError }] =
      await Promise.all([
        supabase
          .from('lab_results')
          .select('*')
          .order('report_date', { ascending: false })
          .order('product_name', { ascending: true }),
        supabase
          .from('products')
          .select('id, name, slug, strength, image_url, box_image_url, coa_url')
          .not('coa_url', 'is', null),
      ]);

    if (labError) return NextResponse.json({ error: labError.message }, { status: 500 });
    if (productError) return NextResponse.json({ error: productError.message }, { status: 500 });

    const productsByCoa = new Map<string, unknown[]>();
    for (const p of products ?? []) {
      for (const url of (p.coa_url as string[] | null) ?? []) {
        const list = productsByCoa.get(url) ?? [];
        list.push({ id: p.id, name: p.name, slug: p.slug, strength: p.strength, image_url: p.image_url, box_image_url: p.box_image_url });
        productsByCoa.set(url, list);
      }
    }

    const results = (labResults ?? []).map((lab) => ({
      ...lab,
      products: productsByCoa.get(lab.report_url) ?? [],
    }));

    return NextResponse.json({ labResults: results });
  } catch (e) {
    console.error('Unexpected error (lab-results GET):', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST: create a new lab result.
export async function POST(request: NextRequest) {
  const { authorized, userId } = await verifyLabResultsAccess(supabase, request, true);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const patch = sanitizeLabResult(body);

    if (!patch.report_url || !patch.product_name) {
      return NextResponse.json(
        { error: 'report_url and product_name are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('lab_results')
      .insert(patch)
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

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'lab_result.create',
      entity_type: 'lab_result',
      entity_id: data.id,
      payload: { product_name: data.product_name },
    });

    return NextResponse.json({ labResult: data }, { status: 201 });
  } catch (e) {
    await logErrorServer(supabase, {
      area: 'lab-results',
      route: '/api/admin/lab-results',
      method: 'POST',
      error: e,
      actor_id: userId,
    });
    console.error('Unexpected error (lab-results POST):', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
