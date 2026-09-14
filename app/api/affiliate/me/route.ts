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
    .select(
      'id, role, first_name, price_currency, pricing_mode, applied_pricelist_id, applied_pricelist:pricelists!customers_applied_pricelist_id_fkey(id, name, currency)',
    )
    .eq('id', user.id)
    .maybeSingle();
  return customer;
}

/**
 * GET /api/affiliate/me
 * Summary for the affiliate's minimized dashboard: bound customers, referral
 * code and earnings (referral commissions + sales-person commissions).
 */
export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller || caller.role !== 'affiliate') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const affiliateId = caller.id;

  const [{ count: boundCustomers }, codeRes, refComm, salesPersonRes] = await Promise.all([
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('affiliate_id', affiliateId),
    supabase
      .from('referral_codes')
      .select('code')
      .eq('affiliate_id', affiliateId)
      .eq('active', true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('commissions')
      .select('amount, status')
      .eq('affiliate_id', affiliateId),
    supabase
      .from('sales_persons')
      .select('*')
      .eq('user_id', affiliateId)
      .maybeSingle(),
  ]);

  let pending = 0;
  let paid = 0;
  for (const c of refComm.data ?? []) {
    if (c.status === 'paid') paid += Number(c.amount) || 0;
    else if (c.status === 'pending') pending += Number(c.amount) || 0;
  }

  // Sales-person commissions (invoices the affiliate is assigned to).
  if (salesPersonRes.data?.id) {
    const { data: salesComm } = await supabase
      .from('sales_commissions')
      .select('amount, status')
      .eq('sales_person_id', salesPersonRes.data.id);
    for (const c of salesComm ?? []) {
      if (c.status === 'paid') paid += Number(c.amount) || 0;
      else if (c.status === 'pending') pending += Number(c.amount) || 0;
    }
  }

  return NextResponse.json({
    firstName: caller.first_name ?? '',
    referralCode: codeRes.data?.code ?? null,
    boundCustomers: boundCustomers ?? 0,
    pendingEarnings: Number(pending.toFixed(2)),
    paidEarnings: Number(paid.toFixed(2)),
    salesPerson: salesPersonRes.data ?? null,
    // Pricing config surfaced (locked) on the affiliate invoice form: the
    // currency they're billed in, whether their prices follow a shared list
    // ('template') or are bespoke ('dedicated'), and the source list's name.
    priceCurrency: (caller as any).price_currency === 'USD' ? 'USD' : 'CAD',
    pricingMode: (caller as any).pricing_mode === 'dedicated' ? 'dedicated' : 'template',
    appliedPricelist: (caller as any).applied_pricelist
      ? {
          id: (caller as any).applied_pricelist.id,
          name: (caller as any).applied_pricelist.name,
          currency: (caller as any).applied_pricelist.currency ?? 'CAD',
        }
      : null,
  });
}
