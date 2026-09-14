import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildInvoiceHtml } from '@/lib/admin/invoice-html';
import { getInvoiceCaller, affiliateCanAccessInvoice } from '@/lib/admin/invoice-access';
import { loadInvoiceRosters } from '@/lib/admin/sales-attribution';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await getInvoiceCaller(supabase, request);
  if (!caller || caller.role === 'customer') {
    return new NextResponse('Unauthorized', { status: 403 });
  }
  const { id } = await ctx.params;

  // Affiliates may only open PDFs for their own customers' invoices.
  if (caller.role === 'affiliate' && !(await affiliateCanAccessInvoice(supabase, caller.id, id))) {
    return new NextResponse('Unauthorized', { status: 403 });
  }
  const download = request.nextUrl.searchParams.get('download') === '1';

  const { data: inv, error } = await supabase
    .from('invoices')
    .select(`
      *,
      customer:customers!customer_id (*),
      client:customer_clients!client_id (*),
      sales_person:sales_persons (*),
      line_items:invoice_line_items (*, product:products (sku)),
      payments (*)
    `)
    .eq('id', id)
    .single();
  if (error || !inv) return new NextResponse('Not found', { status: 404 });

  // The roster is fetched separately (never embedded) so a database that
  // hasn't run the migration still renders the document off the primary.
  const rosters = await loadInvoiceRosters(supabase, [id]);
  const html = buildInvoiceHtml(
    { ...inv, sales_people: rosters.get(id) ?? [] },
    { autoPrint: download },
  );

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
