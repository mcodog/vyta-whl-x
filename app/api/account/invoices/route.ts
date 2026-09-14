import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { effectiveStatus } from '@/lib/admin/invoice-status';
import type { InvoiceStatus } from '@/lib/supabase';

/**
 * GET /api/account/invoices
 *
 * The signed-in customer's own invoices, for their account dashboard.
 *
 * Invoices carry no customer-facing RLS policy (the table is admin/service-role
 * only), so this route runs on the service key and scopes every read to the
 * caller's own id — taken from their bearer token, never from a query
 * parameter. A customer can only ever see their own rows.
 *
 * An invoice in `pending_payment` is one raised when they were handed off to
 * the hosted checkout and not yet paid; its `payment_link` is returned so the
 * dashboard can offer them a way to finish paying.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Columns every database has. */
const BASE_COLUMNS = `
  id,
  invoice_number,
  status,
  issue_date,
  due_date,
  subtotal,
  shipping_cost,
  total,
  currency,
  source,
  fulfillment_status,
  created_at,
  order:orders!order_id ( order_number, tracking_number, tracking_url, carrier )
`;
/** Plus the resume link, which comes from a later migration. */
const COLUMNS_WITH_LINK = `${BASE_COLUMNS.trimEnd()},\n  checkout_payment_link`;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser(authHeader.slice('Bearer '.length));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Read with the resume link when the column exists, falling back to the base
  // set so a database that hasn't run the migration still lists invoices
  // (without an inline pay link) rather than erroring.
  const read = async (columns: string) =>
    supabase
      .from('invoices')
      .select(columns)
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);

  let rows: any[] | null = null;
  {
    const withLink = await read(COLUMNS_WITH_LINK);
    if (withLink.error) {
      const base = await read(BASE_COLUMNS);
      if (base.error) {
        console.error('Account invoices read failed:', base.error);
        return NextResponse.json({ error: 'Could not load invoices' }, { status: 500 });
      }
      rows = base.data as any[];
    } else {
      rows = withLink.data as any[];
    }
  }

  const invoices = (rows ?? []).map((row) => {
    const status = row.status as InvoiceStatus;
    const pending = status === 'pending_payment';
    return {
      id: row.id,
      invoice_number: row.invoice_number,
      // `pending_payment` is never swept to overdue, so effectiveStatus leaves
      // it alone — but run it so a genuinely overdue invoice reads correctly.
      status: row.due_date ? effectiveStatus(status, row.due_date) : status,
      issue_date: row.issue_date,
      subtotal: Number(row.subtotal ?? 0),
      shipping_cost: Number(row.shipping_cost ?? 0),
      total: Number(row.total ?? 0),
      currency: row.currency === 'USD' ? 'USD' : 'CAD',
      source: row.source ?? null,
      fulfillment_status: row.fulfillment_status ?? null,
      created_at: row.created_at,
      order_number: row.order?.order_number ?? null,
      tracking_number: row.order?.tracking_number ?? null,
      tracking_url: row.order?.tracking_url ?? null,
      carrier: row.order?.carrier ?? null,
      // Only hand back a payment link for an invoice that still needs paying —
      // a stale link on a settled invoice would invite a second payment.
      payment_link: pending ? (row.checkout_payment_link ?? null) : null,
    };
  });

  return NextResponse.json({ invoices });
}
