import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { effectiveStatus } from '@/lib/admin/invoice-status';
import { affiliateSalesPersonId } from '@/lib/admin/invoice-access';
import { coSoldInvoiceIds } from '@/lib/admin/sales-attribution';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getCaller(request: NextRequest): Promise<{ id: string; role: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  return { id: user.id, role: customer?.role || 'customer' };
}

/**
 * GET /api/affiliate/invoices
 * Invoices the signed-in affiliate is the SALES PERSON on — surfaced on their
 * client portal. Read-only summary rows (newest first).
 */
export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller || caller.role !== 'affiliate') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const salesPersonId = await affiliateSalesPersonId(supabase, caller.id);
  if (!salesPersonId) {
    return NextResponse.json({ invoices: [], totals: { count: 0, outstanding: 0, paid: 0 } });
  }

  await supabase.rpc('mark_overdue_invoices');

  // Invoices they are credited on: the ones where they're the primary (the
  // sales_person_id column) plus any they co-sold, which only the roster names.
  const coSold = await coSoldInvoiceIds(supabase, salesPersonId);
  const scope =
    coSold.length > 0
      ? `sales_person_id.eq.${salesPersonId},id.in.(${coSold.join(',')})`
      : `sales_person_id.eq.${salesPersonId}`;

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      status,
      issue_date,
      due_date,
      total,
      currency,
      customer_name,
      created_at,
      customer:customers!customer_id (id, first_name, last_name, email),
      payments ( amount )
    `)
    .or(scope)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error listing affiliate invoices:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let outstanding = 0;
  let paidCount = 0;
  const invoices = (data ?? []).map((row: any) => {
    const amount_paid = (row.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
    const amount_due = Math.max(0, Number(row.total) - amount_paid);
    const status_effective = effectiveStatus(row.status, row.due_date);
    // As above: an unpaid hosted checkout is not a receivable.
    if (
      row.status !== 'paid' &&
      row.status !== 'draft' &&
      row.status !== 'pending_payment' &&
      row.status !== 'cancelled'
    ) {
      outstanding += amount_due;
    }
    if (row.status === 'paid') paidCount += 1;
    const customer_name =
      row.customer_name ??
      (row.customer
        ? [row.customer.first_name, row.customer.last_name].filter(Boolean).join(' ')
        : null);
    return {
      id: row.id,
      invoice_number: row.invoice_number,
      status: row.status,
      status_effective,
      issue_date: row.issue_date,
      due_date: row.due_date,
      total: Number(row.total),
      currency: row.currency ?? 'CAD',
      customer_name,
      amount_paid,
      amount_due,
      created_at: row.created_at,
    };
  });

  return NextResponse.json({
    invoices,
    totals: { count: invoices.length, outstanding: Number(outstanding.toFixed(2)), paid: paidCount },
  });
}
