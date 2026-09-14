import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getCaller(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: customer } = await supabase
    .from('customers')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();
  return customer;
}

interface CommissionRow {
  id: string;
  source: 'referral' | 'sales';
  amount: number;
  base: number; // order/invoice total the commission was calculated on
  rate: number | null;
  status: string;
  reference: string | null; // order number / invoice number
  created_at: string;
}

/**
 * GET /api/affiliate/commissions
 * The logged-in affiliate's commission report — both referral commissions
 * (orders via their code) and sales-person commissions (invoices they're on).
 */
export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller || caller.role !== 'affiliate') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const affiliateId = caller.id;

  const rows: CommissionRow[] = [];

  // Referral commissions.
  const { data: refComm } = await supabase
    .from('commissions')
    .select('id, amount, order_total, commission_rate, status, created_at, order_id')
    .eq('affiliate_id', affiliateId)
    .order('created_at', { ascending: false });
  for (const c of refComm ?? []) {
    rows.push({
      id: c.id,
      source: 'referral',
      amount: Number(c.amount) || 0,
      base: Number(c.order_total) || 0,
      rate: c.commission_rate != null ? Number(c.commission_rate) : null,
      status: c.status,
      reference: c.order_id ? String(c.order_id).slice(0, 8) : null,
      created_at: c.created_at,
    });
  }

  // Sales-person commissions (invoices the affiliate is the sales person on).
  const { data: sp } = await supabase
    .from('sales_persons')
    .select('id')
    .eq('user_id', affiliateId)
    .maybeSingle();
  if (sp?.id) {
    const { data: salesComm } = await supabase
      .from('sales_commissions')
      .select('id, amount, invoice_total, commission_rate, status, created_at, invoice:invoices(invoice_number)')
      .eq('sales_person_id', sp.id)
      .order('created_at', { ascending: false });
    for (const c of salesComm ?? []) {
      const invoice = (c.invoice as { invoice_number?: string } | null) ?? null;
      rows.push({
        id: c.id,
        source: 'sales',
        amount: Number(c.amount) || 0,
        base: Number(c.invoice_total) || 0,
        rate: c.commission_rate != null ? Number(c.commission_rate) : null,
        status: c.status,
        reference: invoice?.invoice_number ?? null,
        created_at: c.created_at,
      });
    }
  }

  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const totals = rows.reduce(
    (acc, r) => {
      if (r.status === 'paid') acc.paid += r.amount;
      else if (r.status === 'pending') acc.pending += r.amount;
      acc.total += r.amount;
      return acc;
    },
    { paid: 0, pending: 0, total: 0 },
  );

  return NextResponse.json({
    commissions: rows,
    totals: {
      paid: Number(totals.paid.toFixed(2)),
      pending: Number(totals.pending.toFixed(2)),
      total: Number(totals.total.toFixed(2)),
    },
  });
}
