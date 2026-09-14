import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET /api/customers/clients
 * The signed-in customer's own ship-to clients (end-recipients) and the
 * shipments that went to them. A reseller customer places orders that ship to
 * their client's address; the invoice bills the customer while the client
 * receives only a packing list. This surfaces that same relationship on the
 * customer's account dashboard — clients + the fulfillment/tracking status of
 * each shipment sent to them.
 *
 * Auth: the customer's Supabase access token as a Bearer header. We derive the
 * customer id from the verified token and scope every query to it, so a caller
 * only ever sees their own clients and shipments. No pricing detail is exposed
 * beyond the customer's own invoice totals (this is their own billing data).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const customerId = user.id;

  const [clientsRes, invoicesRes] = await Promise.all([
    supabase
      .from('customer_clients')
      .select(
        'id, first_name, last_name, address, city, state, postal_code, country, phone, email, created_at',
      )
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false }),
    supabase
      .from('invoices')
      .select(
        'id, invoice_number, status, currency, total, issue_date, created_at, ' +
          'fulfillment_status, fulfillment_type, client_id, order_id',
      )
      .eq('customer_id', customerId)
      .eq('ships_to_client', true)
      .order('issue_date', { ascending: false }),
  ]);

  if (clientsRes.error) {
    // A missing table pre-migration lands here; treat as "no clients" rather
    // than erroring the whole dashboard.
    console.error('Failed to load customer clients:', clientsRes.error);
    return NextResponse.json({ clients: [], shipments: [] });
  }

  const clients = clientsRes.data ?? [];
  const invoices = invoicesRes.data ?? [];

  // Pull tracking for the orders bound to those ship-to-client invoices, so each
  // shipment can show where it is (carrier + tracking link) without leaking any
  // other customer's data — we only ask for the ids we already own.
  const orderIds = [...new Set(invoices.map((i) => i.order_id).filter(Boolean))] as string[];
  const ordersById: Record<string, {
    order_number: string | null;
    status: string | null;
    tracking_number: string | null;
    tracking_status: string | null;
    tracking_url: string | null;
    carrier: string | null;
  }> = {};
  if (orderIds.length) {
    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_number, status, tracking_number, tracking_status, tracking_url, carrier')
      .in('id', orderIds);
    for (const o of orders ?? []) {
      ordersById[o.id] = {
        order_number: o.order_number ?? null,
        status: o.status ?? null,
        tracking_number: o.tracking_number ?? null,
        tracking_status: o.tracking_status ?? null,
        tracking_url: o.tracking_url ?? null,
        carrier: o.carrier ?? null,
      };
    }
  }

  const shipments = invoices.map((inv) => ({
    id: inv.id,
    invoice_number: inv.invoice_number,
    status: inv.status,
    currency: inv.currency,
    total: Number(inv.total) || 0,
    issue_date: inv.issue_date,
    created_at: inv.created_at,
    fulfillment_status: inv.fulfillment_status,
    fulfillment_type: inv.fulfillment_type,
    client_id: inv.client_id,
    tracking: inv.order_id ? ordersById[inv.order_id] ?? null : null,
  }));

  return NextResponse.json({ clients, shipments });
}
