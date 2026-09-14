import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function isAdminOrAssistant(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return false;
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .single();
  const role = customer?.role || 'customer';
  return role === 'admin' || role === 'assistant';
}

type Source = 'affiliate' | 'sales';
type Row = {
  id: string;
  source: Source;
  recipient_name: string;
  recipient_email: string;
  reference: string;
  total: number;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
};

const escape = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (n: number) => `$${Number(n ?? 0).toFixed(2)}`;

export async function GET(request: NextRequest) {
  if (!(await isAdminOrAssistant(request))) {
    return new NextResponse('Unauthorized', { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const sourceFilter = sp.get('source') ?? 'all';
  const statusFilter = sp.get('status') ?? 'all';
  const recipientFilter = sp.get('recipient') ?? 'all';
  const search = (sp.get('q') ?? '').toLowerCase();
  const autoPrint = sp.get('print') !== '0';

  const [{ data: aff }, { data: sales }] = await Promise.all([
    supabase
      .from('commissions')
      .select(`*, affiliates (email, first_name, last_name), orders!commissions_order_id_fkey (order_number)`)
      .order('created_at', { ascending: false }),
    supabase
      .from('sales_commissions')
      .select(`*, sales_persons (email, first_name, last_name), invoices (invoice_number)`)
      .order('created_at', { ascending: false }),
  ]);

  const affRows: Row[] = (aff ?? []).map((c: any) => ({
    id: c.id,
    source: 'affiliate',
    recipient_name: c.affiliates
      ? `${c.affiliates.first_name} ${c.affiliates.last_name}`.trim()
      : '—',
    recipient_email: c.affiliates?.email ?? '',
    reference: c.orders?.order_number || c.order_id?.slice(0, 8) || '—',
    total: Number(c.order_total ?? 0),
    amount: Number(c.amount ?? 0),
    status: c.status,
    paid_at: c.paid_at,
    created_at: c.created_at,
  }));
  const salesRows: Row[] = (sales ?? []).map((c: any) => ({
    id: c.id,
    source: 'sales',
    recipient_name: c.sales_persons
      ? `${c.sales_persons.first_name} ${c.sales_persons.last_name}`.trim()
      : '—',
    recipient_email: c.sales_persons?.email ?? '',
    reference: c.invoices?.invoice_number || c.invoice_id?.slice(0, 8) || '—',
    total: Number(c.invoice_total ?? 0),
    amount: Number(c.amount ?? 0),
    status: c.status,
    paid_at: c.paid_at,
    created_at: c.created_at,
  }));

  let rows = [...affRows, ...salesRows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  if (sourceFilter !== 'all') rows = rows.filter((r) => r.source === sourceFilter);
  if (statusFilter !== 'all') rows = rows.filter((r) => r.status === statusFilter);
  if (recipientFilter !== 'all') {
    const [src, ...nameParts] = recipientFilter.split('::');
    const name = nameParts.join('::');
    rows = rows.filter((r) => r.source === src && r.recipient_name === name);
  }
  if (search) {
    rows = rows.filter(
      (r) =>
        r.recipient_name.toLowerCase().includes(search) ||
        r.recipient_email.toLowerCase().includes(search) ||
        r.reference.toLowerCase().includes(search),
    );
  }

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const pendingTotal = rows.filter((r) => r.status === 'pending').reduce((s, r) => s + r.amount, 0);
  const paidTotal = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0);
  const cancelledTotal = rows.filter((r) => r.status === 'cancelled').reduce((s, r) => s + r.amount, 0);
  const affiliateCount = rows.filter((r) => r.source === 'affiliate').length;
  const salesCount = rows.filter((r) => r.source === 'sales').length;

  // Per-recipient breakdown
  const byRecipient = new Map<
    string,
    { name: string; source: Source; count: number; total: number; pending: number; paid: number }
  >();
  for (const r of rows) {
    const key = `${r.source}::${r.recipient_name}`;
    const entry = byRecipient.get(key) ?? {
      name: r.recipient_name,
      source: r.source,
      count: 0,
      total: 0,
      pending: 0,
      paid: 0,
    };
    entry.count += 1;
    entry.total += r.amount;
    if (r.status === 'pending') entry.pending += r.amount;
    if (r.status === 'paid') entry.paid += r.amount;
    byRecipient.set(key, entry);
  }
  const breakdown = Array.from(byRecipient.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const appliedFilters: string[] = [];
  if (sourceFilter !== 'all') appliedFilters.push(`Source: ${sourceFilter}`);
  if (statusFilter !== 'all') appliedFilters.push(`Status: ${statusFilter}`);
  if (recipientFilter !== 'all') {
    const [, ...nameParts] = recipientFilter.split('::');
    appliedFilters.push(`Recipient: ${nameParts.join('::')}`);
  }
  if (search) appliedFilters.push(`Search: "${search}"`);
  if (appliedFilters.length === 0) appliedFilters.push('None — all commissions');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Commissions Report</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         color: #1A1A1A; margin: 0; padding: 28px; background: #fff; }
  .wrap { max-width: 820px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.02em; }
  .sub { font-size: 12px; color: #6E6E6E; margin: 0 0 18px; }
  .filters { background: #F7F7F7; border-radius: 8px; padding: 12px 16px; font-size: 12px; margin-bottom: 18px; }
  .filters strong { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #6E6E6E; margin-right: 6px; }
  .filters span { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #fff; border: 1px solid #E5E7EB; margin-right: 6px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
  .stat { padding: 14px; border: 1px solid #E5E7EB; border-radius: 10px; }
  .stat .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #6E6E6E; margin-bottom: 6px; }
  .stat .value { font-size: 18px; font-weight: 700; }
  .stat.pending .value { color: #B45309; }
  .stat.paid .value { color: #047857; }
  .stat.total .value { color: #1A1A1A; }
  .stat .meta { font-size: 11px; color: #6E6E6E; margin-top: 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #6E6E6E; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6E6E6E; padding: 8px 6px; border-bottom: 1px solid #C9CCD1; }
  td { padding: 8px 6px; border-bottom: 1px solid #F2F2F2; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; }
  .pill.aff { background: #DBEAFE; color: #1E40AF; }
  .pill.sales { background: #EDE9FE; color: #6D28D9; }
  .pill.pending { background: #FEF3C7; color: #92400E; }
  .pill.paid { background: #D1FAE5; color: #065F46; }
  .pill.cancelled { background: #FEE2E2; color: #991B1B; }
  .empty { padding: 24px; text-align: center; color: #6E6E6E; font-size: 12px; }
  .foot { margin-top: 32px; padding-top: 12px; border-top: 1px solid #C9CCD1; font-size: 10px; color: #6E6E6E; display: flex; justify-content: space-between; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>Commissions Report</h1>
  <p class="sub">PuraMass · Generated ${escape(new Date().toLocaleString())}</p>

  <div class="filters">
    <strong>Filters</strong>
    ${appliedFilters.map((f) => `<span>${escape(f)}</span>`).join('')}
  </div>

  <div class="stats">
    <div class="stat total">
      <div class="label">Total</div>
      <div class="value">${money(total)}</div>
      <div class="meta">${rows.length} commission${rows.length === 1 ? '' : 's'}</div>
    </div>
    <div class="stat pending">
      <div class="label">Pending</div>
      <div class="value">${money(pendingTotal)}</div>
    </div>
    <div class="stat paid">
      <div class="label">Paid</div>
      <div class="value">${money(paidTotal)}</div>
    </div>
    <div class="stat">
      <div class="label">Mix</div>
      <div class="value" style="font-size: 14px;">${affiliateCount} aff · ${salesCount} sales</div>
      ${cancelledTotal > 0 ? `<div class="meta">${money(cancelledTotal)} cancelled</div>` : ''}
    </div>
  </div>

  <h2>Top recipients</h2>
  ${breakdown.length === 0 ? '<div class="empty">No commissions match the filters.</div>' : `
  <table>
    <thead>
      <tr>
        <th>Recipient</th>
        <th>Source</th>
        <th class="num">Count</th>
        <th class="num">Pending</th>
        <th class="num">Paid</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${breakdown.map((b) => `
        <tr>
          <td>${escape(b.name)}</td>
          <td><span class="pill ${b.source === 'affiliate' ? 'aff' : 'sales'}">${b.source === 'affiliate' ? 'Affiliate' : 'Sales'}</span></td>
          <td class="num">${b.count}</td>
          <td class="num">${money(b.pending)}</td>
          <td class="num">${money(b.paid)}</td>
          <td class="num"><strong>${money(b.total)}</strong></td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  `}

  <h2>All commissions${rows.length > 0 ? ` (${rows.length})` : ''}</h2>
  ${rows.length === 0 ? '<div class="empty">No commissions match the filters.</div>' : `
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Recipient</th>
        <th>Source</th>
        <th>Reference</th>
        <th class="num">Order/Inv Total</th>
        <th class="num">Commission</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((r) => `
        <tr>
          <td>${escape(new Date(r.created_at).toLocaleDateString())}</td>
          <td>${escape(r.recipient_name)}${r.recipient_email ? `<div style="font-size: 10px; color: #6E6E6E;">${escape(r.recipient_email)}</div>` : ''}</td>
          <td><span class="pill ${r.source === 'affiliate' ? 'aff' : 'sales'}">${r.source === 'affiliate' ? 'Affiliate' : 'Sales'}</span></td>
          <td style="font-family: ui-monospace, Menlo, Consolas, monospace;">${escape(r.reference)}</td>
          <td class="num">${money(r.total)}</td>
          <td class="num"><strong>${money(r.amount)}</strong></td>
          <td><span class="pill ${escape(r.status)}">${escape(r.status)}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  `}

  <div class="foot">
    <span>PuraMass · Commissions Report</span>
    <span>${rows.length} row${rows.length === 1 ? '' : 's'}</span>
  </div>
</div>
${autoPrint ? `<script>window.addEventListener("load", () => { setTimeout(() => window.print(), 300); });</script>` : ''}
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
