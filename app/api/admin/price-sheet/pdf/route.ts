import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildPriceSheetData, type PriceSheetKind } from '@/lib/admin/price-sheet';
import { renderPriceSheetPdf, priceSheetFileName } from '@/lib/admin/price-sheet-pdf';

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

// GET /api/admin/price-sheet/pdf?type=customer|salesperson&id=<uuid>&inventory=0|1
// Returns the real, attachable price-list PDF for one customer or sales person.
// Used by the admin "Preview & email" modal to preview the exact file that will
// be attached, and available for direct download.
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

  const data = await buildPriceSheetData(supabase, { kind, id, includeInventory });
  if (data === null) {
    return new NextResponse(kind === 'customer' ? 'Customer not found' : 'Sales person not found', {
      status: 404,
    });
  }

  const pdf = await renderPriceSheetPdf(data);
  const filename = priceSheetFileName(data);
  const disposition = sp.get('download') === '1' ? 'attachment' : 'inline';

  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
