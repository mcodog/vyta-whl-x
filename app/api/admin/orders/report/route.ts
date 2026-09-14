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

const STATUS_TONE: Record<string, string> = {
  pending: 'amber',
  pending_invoice: 'amber',
  received: 'blue',
  confirmed: 'blue',
  processing: 'amber',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  expired: 'red',
};

export async function GET(request: NextRequest) {
  const role = await getRole(request);
  if (role !== 'admin' && role !== 'assistant') {
    return new NextResponse('Unauthorized', { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const search = (sp.get('q') ?? '').toLowerCase();
  const statusFilter = sp.get('status') ?? 'all';
  const sourceFilter = sp.get('source') ?? 'all';

  // Select * so the report still works before optional columns (e.g.
  // discount_amount, source) have been migrated in; missing fields read as
  // undefined and are handled defensively below.
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });

  const sourceOf = (o: any) => o.source || o.crypto || '—';

  let rows = (orders ?? []).filter((o: any) => {
    if (search) {
      const ship = (o.shipping_address ?? {}) as any;
      const name = `${ship.firstName ?? ''} ${ship.lastName ?? ''}`;
      const hay = `${o.order_number ?? ''} ${o.email ?? ''} ${name}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (sourceFilter !== 'all' && sourceOf(o) !== sourceFilter) return false;
    return true;
  });

  const nonCancelled = rows.filter((o: any) => o.status !== 'cancelled');
  const totalOrders = rows.length;
  const revenue = nonCancelled.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const avgOrder = nonCancelled.length ? revenue / nonCancelled.length : 0;
  const totalDiscount = rows.reduce((s: number, o: any) => s + (Number(o.discount_amount) || 0), 0);

  // Status breakdown.
  const byStatus = new Map<string, number>();
  for (const o of rows) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  const statusSummary = Array.from(byStatus.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s}: ${n}`)
    .join(' · ');

  const tableRows = rows.map((o: any) => {
    const ship = (o.shipping_address ?? {}) as any;
    const name = `${ship.firstName ?? ''} ${ship.lastName ?? ''}`.trim();
    const itemCount = Array.isArray(o.items)
      ? o.items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0)
      : 0;
    return [
      `<span class="mono">${escapeHtml(o.order_number ?? '—')}</span>`,
      escapeHtml(formatDate(o.created_at)),
      `${escapeHtml(name || '—')}<div class="muted">${escapeHtml(o.email ?? '')}</div>`,
      escapeHtml(sourceOf(o)),
      String(itemCount),
      Number(o.discount_amount) ? money(Number(o.discount_amount)) : '—',
      money(Number(o.total) || 0),
      pill(o.status ?? '—', STATUS_TONE[o.status] ?? ''),
    ];
  });

  const filters: string[] = [];
  if (search) filters.push(`Search: "${search}"`);
  if (statusFilter !== 'all') filters.push(`Status: ${statusFilter}`);
  if (sourceFilter !== 'all') filters.push(`Source: ${sourceFilter}`);
  if (filters.length === 0) filters.push('None — all orders');

  const body = `
    ${statsGrid([
      { label: 'Orders', value: String(totalOrders), meta: statusSummary || undefined },
      { label: 'Revenue', value: money(revenue), meta: `excl. cancelled`, tone: 'paid' },
      { label: 'Avg Order Value', value: money(avgOrder) },
      { label: 'Affiliate Discounts', value: money(totalDiscount), tone: 'pending' },
    ])}
    <h2>All orders (${totalOrders})</h2>
    ${table(
      [
        { header: 'Order #' },
        { header: 'Date' },
        { header: 'Customer' },
        { header: 'Source' },
        { header: 'Items', num: true },
        { header: 'Discount', num: true },
        { header: 'Total', num: true },
        { header: 'Status' },
      ],
      tableRows,
      'No orders match the filters.',
    )}
  `;

  const html = reportShell({
    title: 'Orders Report',
    filters,
    body,
    footRight: `${totalOrders} order${totalOrders === 1 ? '' : 's'}`,
    autoPrint: sp.get('print') !== '0',
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
