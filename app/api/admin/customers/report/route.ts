import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  reportShell,
  statsGrid,
  table,
  pill,
  money,
  escapeHtml,
  formatDate,
} from '@/lib/admin/report-html';

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

export async function GET(request: NextRequest) {
  const role = await getRole(request);
  if (role !== 'admin' && role !== 'assistant') {
    return new NextResponse('Unauthorized', { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const search = (sp.get('q') ?? '').toLowerCase();
  const affiliateFilter = sp.get('affiliate') ?? 'all'; // all | with | without
  const activeFilter = sp.get('active') ?? 'all'; // all | active | inactive

  const { data: customers } = await supabase
    .from('customers')
    .select(
      '*, bound_affiliate:affiliates!customers_affiliate_id_fkey(first_name, last_name, email)',
    )
    .order('created_at', { ascending: false });

  // Aggregate order count + lifetime spend per customer (excluding cancelled).
  const { data: orders } = await supabase
    .from('orders')
    .select('customer_id, total, status');
  const spendByCustomer = new Map<string, { count: number; total: number }>();
  for (const o of orders ?? []) {
    if (!o.customer_id || o.status === 'cancelled') continue;
    const e = spendByCustomer.get(o.customer_id) ?? { count: 0, total: 0 };
    e.count += 1;
    e.total += Number(o.total) || 0;
    spendByCustomer.set(o.customer_id, e);
  }

  let rows = (customers ?? []).filter((c: any) => {
    if (search) {
      const hay = `${c.first_name ?? ''} ${c.last_name ?? ''} ${c.email ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (affiliateFilter === 'with' && !c.affiliate_id) return false;
    if (affiliateFilter === 'without' && c.affiliate_id) return false;
    if (activeFilter === 'active' && c.active === false) return false;
    if (activeFilter === 'inactive' && c.active !== false) return false;
    return true;
  });

  const totalCustomers = rows.length;
  const activeCount = rows.filter((c: any) => c.active !== false).length;
  const withAffiliate = rows.filter((c: any) => c.affiliate_id).length;
  const staffCount = rows.filter((c: any) => c.role === 'admin' || c.role === 'assistant').length;
  const lifetimeRevenue = rows.reduce(
    (s: number, c: any) => s + (spendByCustomer.get(c.id)?.total ?? 0),
    0,
  );

  const roleTone: Record<string, string> = {
    admin: 'admin',
    assistant: 'purple',
    affiliate: 'blue',
    customer: '',
  };

  const tableRows = rows.map((c: any) => {
    const stats = spendByCustomer.get(c.id) ?? { count: 0, total: 0 };
    const aff = c.bound_affiliate
      ? `${c.bound_affiliate.first_name ?? ''} ${c.bound_affiliate.last_name ?? ''}`.trim()
      : '—';
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—';
    return [
      `${escapeHtml(name)}<div class="muted">${escapeHtml(c.email ?? '')}</div>`,
      escapeHtml(c.phone || '—'),
      pill((c.role || 'customer').toString(), roleTone[c.role] ?? ''),
      escapeHtml(aff),
      String(stats.count),
      money(stats.total),
      escapeHtml(formatDate(c.created_at)),
      c.active === false ? pill('Inactive', 'inactive') : pill('Active', 'active'),
    ];
  });

  const filters: string[] = [];
  if (search) filters.push(`Search: "${search}"`);
  if (affiliateFilter !== 'all') filters.push(`Affiliate: ${affiliateFilter}`);
  if (activeFilter !== 'all') filters.push(`Status: ${activeFilter}`);
  if (filters.length === 0) filters.push('None — all customers');

  const body = `
    ${statsGrid([
      { label: 'Customers', value: String(totalCustomers), meta: `${activeCount} active` },
      { label: 'With Affiliate', value: String(withAffiliate) },
      { label: 'Staff Accounts', value: String(staffCount) },
      { label: 'Lifetime Revenue', value: money(lifetimeRevenue), tone: 'paid' },
    ])}
    <h2>All customers (${totalCustomers})</h2>
    ${table(
      [
        { header: 'Customer' },
        { header: 'Phone' },
        { header: 'Role' },
        { header: 'Affiliate' },
        { header: 'Orders', num: true },
        { header: 'Lifetime Spend', num: true },
        { header: 'Joined' },
        { header: 'Status' },
      ],
      tableRows,
      'No customers match the filters.',
    )}
  `;

  const html = reportShell({
    title: 'Customers Report',
    filters,
    body,
    footRight: `${totalCustomers} customer${totalCustomers === 1 ? '' : 's'}`,
    autoPrint: sp.get('print') !== '0',
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
