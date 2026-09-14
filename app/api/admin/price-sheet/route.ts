import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildPriceSheet, type PriceSheetKind } from '@/lib/admin/price-sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getRole(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return 'customer';
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return 'customer';
  const { data: c } = await supabase.from('customers').select('role').eq('id', user.id).maybeSingle();
  return c?.role || 'customer';
}

// GET /api/admin/price-sheet?type=customer|salesperson&id=<uuid>&inventory=0|1
// Returns a print-ready HTML price list for one customer or sales person.
export async function GET(request: NextRequest) {
  const role = await getRole(request);
  if (role !== 'admin' && role !== 'assistant') {
    return new NextResponse('Unauthorized', { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const rawType = sp.get('type');
  const kind: PriceSheetKind =
    rawType === 'salesperson' || rawType === 'sales_person' ? 'salesperson' : 'customer';
  const id = (sp.get('id') ?? '').trim();
  if (!id) return new NextResponse('Missing id', { status: 400 });
  const includeInventory = sp.get('inventory') === '1';

  const html = await buildPriceSheet(supabase, { kind, id, includeInventory });
  if (html === null) {
    return new NextResponse(kind === 'customer' ? 'Customer not found' : 'Sales person not found', {
      status: 404,
    });
  }

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
