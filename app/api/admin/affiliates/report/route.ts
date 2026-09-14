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
  const statusFilter = sp.get('status') ?? 'all'; // all | active | inactive

  const [{ data: affiliates }, { data: codes }, { data: commissions }, { data: boundCustomers }] =
    await Promise.all([
      supabase.from('affiliates').select('*').order('created_at', { ascending: false }),
      supabase.from('referral_codes').select('affiliate_id, code, uses_count'),
      supabase.from('commissions').select('affiliate_id, amount, status'),
      supabase.from('customers').select('id, affiliate_id').not('affiliate_id', 'is', null),
    ]);

  // Code(s) per affiliate.
  const codeByAffiliate = new Map<string, string[]>();
  for (const rc of codes ?? []) {
    const arr = codeByAffiliate.get(rc.affiliate_id) ?? [];
    if (rc.code) arr.push(rc.code);
    codeByAffiliate.set(rc.affiliate_id, arr);
  }

  // Commission totals per affiliate.
  const commByAffiliate = new Map<
    string,
    { count: number; pending: number; paid: number; total: number }
  >();
  for (const c of commissions ?? []) {
    const e = commByAffiliate.get(c.affiliate_id) ?? { count: 0, pending: 0, paid: 0, total: 0 };
    const amt = Number(c.amount) || 0;
    e.count += 1;
    e.total += amt;
    if (c.status === 'pending') e.pending += amt;
    if (c.status === 'paid') e.paid += amt;
    commByAffiliate.set(c.affiliate_id, e);
  }

  // Bound customer count + their order revenue per affiliate.
  const customerToAffiliate = new Map<string, string>();
  const boundCountByAffiliate = new Map<string, number>();
  for (const c of boundCustomers ?? []) {
    customerToAffiliate.set(c.id, c.affiliate_id);
    boundCountByAffiliate.set(c.affiliate_id, (boundCountByAffiliate.get(c.affiliate_id) ?? 0) + 1);
  }
  const revenueByAffiliate = new Map<string, number>();
  const custIds = Array.from(customerToAffiliate.keys());
  if (custIds.length > 0) {
    const { data: orders } = await supabase
      .from('orders')
      .select('customer_id, total, status')
      .in('customer_id', custIds);
    for (const o of orders ?? []) {
      if (o.status === 'cancelled') continue;
      const affId = customerToAffiliate.get(o.customer_id);
      if (!affId) continue;
      revenueByAffiliate.set(affId, (revenueByAffiliate.get(affId) ?? 0) + (Number(o.total) || 0));
    }
  }

  let rows = (affiliates ?? []).filter((a: any) => {
    if (search) {
      const codesStr = (codeByAffiliate.get(a.id) ?? []).join(' ');
      const hay = `${a.first_name ?? ''} ${a.last_name ?? ''} ${a.email ?? ''} ${codesStr}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (statusFilter === 'active' && a.active === false) return false;
    if (statusFilter === 'inactive' && a.active !== false) return false;
    return true;
  });

  const totalAffiliates = rows.length;
  const activeCount = rows.filter((a: any) => a.active !== false).length;
  const totalBound = rows.reduce((s: number, a: any) => s + (boundCountByAffiliate.get(a.id) ?? 0), 0);
  const totalRevenue = rows.reduce((s: number, a: any) => s + (revenueByAffiliate.get(a.id) ?? 0), 0);
  const totalCommission = rows.reduce(
    (s: number, a: any) => s + (commByAffiliate.get(a.id)?.total ?? 0),
    0,
  );
  const totalPending = rows.reduce(
    (s: number, a: any) => s + (commByAffiliate.get(a.id)?.pending ?? 0),
    0,
  );

  const tableRows = rows.map((a: any) => {
    const comm = commByAffiliate.get(a.id) ?? { count: 0, pending: 0, paid: 0, total: 0 };
    const name = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || '—';
    const codeList = codeByAffiliate.get(a.id) ?? [];
    return [
      `${escapeHtml(name)}<div class="muted">${escapeHtml(a.email ?? '')}</div>`,
      codeList.length ? `<span class="mono">${escapeHtml(codeList.join(', '))}</span>` : '—',
      String(boundCountByAffiliate.get(a.id) ?? 0),
      money(revenueByAffiliate.get(a.id) ?? 0),
      money(comm.pending),
      money(comm.paid),
      money(comm.total),
      a.active === false ? pill('Inactive', 'inactive') : pill('Active', 'active'),
      escapeHtml(formatDate(a.created_at)),
    ];
  });

  const filters: string[] = [];
  if (search) filters.push(`Search: "${search}"`);
  if (statusFilter !== 'all') filters.push(`Status: ${statusFilter}`);
  if (filters.length === 0) filters.push('None — all affiliates');

  const body = `
    ${statsGrid([
      { label: 'Affiliates', value: String(totalAffiliates), meta: `${activeCount} active` },
      { label: 'Bound Customers', value: String(totalBound) },
      { label: 'Revenue Generated', value: money(totalRevenue), tone: 'paid' },
      { label: 'Commissions', value: money(totalCommission), meta: `${money(totalPending)} pending`, tone: 'pending' },
    ])}
    <h2>All affiliates (${totalAffiliates})</h2>
    ${table(
      [
        { header: 'Affiliate' },
        { header: 'Code(s)' },
        { header: 'Customers', num: true },
        { header: 'Revenue', num: true },
        { header: 'Pending', num: true },
        { header: 'Paid', num: true },
        { header: 'Total Comm.', num: true },
        { header: 'Status' },
        { header: 'Joined' },
      ],
      tableRows,
      'No affiliates match the filters.',
    )}
  `;

  const html = reportShell({
    title: 'Affiliates Report',
    filters,
    body,
    footRight: `${totalAffiliates} affiliate${totalAffiliates === 1 ? '' : 's'}`,
    autoPrint: sp.get('print') !== '0',
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
