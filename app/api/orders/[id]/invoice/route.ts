import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildInvoiceHtml } from '@/lib/admin/invoice-html';
import { autoCreateInvoiceFromOrder } from '@/lib/admin/invoices';
import { loadInvoiceRosters } from '@/lib/admin/sales-attribution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET /api/orders/[id]/invoice
 *
 * Returns the invoice for one of the *signed-in customer's own* orders, rendered
 * as the same on-brand HTML used in the admin portal. The invoice is created on
 * the fly if it doesn't exist yet so customers can always view it.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return new NextResponse('Unauthorized', { status: 401 });
  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const { id: orderId } = await ctx.params;

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, customer_id, email')
    .eq('id', orderId)
    .single();
  if (orderErr || !order) return new NextResponse('Not found', { status: 404 });

  // Ownership check: the order must belong to the caller (by customer id, or by
  // email as a fallback for orders not linked to a customer record).
  const ownsByid = order.customer_id && order.customer_id === user.id;
  const ownsByEmail =
    !!order.email && !!user.email && order.email.toLowerCase() === user.email.toLowerCase();
  if (!ownsByid && !ownsByEmail) {
    return new NextResponse('Unauthorized', { status: 403 });
  }

  // Ensure an invoice exists for this order.
  let { data: inv } = await supabase
    .from('invoices')
    .select(
      `*,
       customer:customers!customer_id (*),
       sales_person:sales_persons (*),
       line_items:invoice_line_items (*, product:products (sku)),
       payments (*)`,
    )
    .eq('order_id', orderId)
    .maybeSingle();

  if (!inv) {
    try {
      await autoCreateInvoiceFromOrder(supabase, orderId);
    } catch (e) {
      console.error('Customer invoice auto-create failed:', e);
    }
    const refetch = await supabase
      .from('invoices')
      .select(
        `*,
         customer:customers!customer_id (*),
         sales_person:sales_persons (*),
         line_items:invoice_line_items (*),
         payments (*)`,
      )
      .eq('order_id', orderId)
      .maybeSingle();
    inv = refetch.data;
  }

  if (!inv) return new NextResponse('Invoice not available', { status: 404 });

  const download = request.nextUrl.searchParams.get('download') === '1';
  // The sales roster is read separately (never embedded) so this customer-facing
  // document still renders on a database that hasn't run the migration.
  const rosters = await loadInvoiceRosters(supabase, [inv.id]);
  const html = buildInvoiceHtml(
    { ...inv, sales_people: rosters.get(String(inv.id)) ?? [] },
    { autoPrint: download },
  );

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
