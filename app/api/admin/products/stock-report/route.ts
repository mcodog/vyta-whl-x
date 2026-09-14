import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  computeStockReport,
  stockReportPrintHtml,
  toStockReportAudience,
  STOCK_REPORT_COLUMN_KEYS,
  type StockReportColumnKey,
} from '@/lib/admin/stock-report';

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

/**
 * Stock Report — a quantities-only view of the catalogue (no prices, no
 * money). For each product it shows current stock, the minimum quantity
 * (low-stock threshold), how much is already on order via open purchase
 * orders, and how much still needs to be ordered to reach the minimum.
 *
 * `?audience=customer` renders the copy you can hand to a customer: the same
 * figures with every purchasing detail removed (Min Quantity, On Order, Need
 * To Order, their summary cards, and the on-order note). The trimming happens
 * in the renderer, not here, so it cannot be undone by a stray `cols` param.
 *
 * The computation lives in `lib/admin/stock-report` so the printable report
 * and the scheduled report email stay in lock-step.
 */
export async function GET(request: NextRequest) {
  const role = await getRole(request);
  if (role !== 'admin' && role !== 'assistant' && role !== 'analytics') {
    return new NextResponse('Unauthorized', { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const data = await computeStockReport(supabase, {
    search: sp.get('q') ?? '',
    category: sp.get('category') ?? 'all',
    status: sp.get('status') ?? 'all',
  });

  // Optional `cols` = comma-separated column keys to include. Unknown keys are
  // ignored; a missing/empty param leaves `columns` undefined so the report
  // renders every column (the default).
  const colsParam = sp.get('cols');
  const validCols = new Set<string>(STOCK_REPORT_COLUMN_KEYS);
  const columns = colsParam
    ? (colsParam.split(',').map((c) => c.trim()).filter((c) => validCols.has(c)) as StockReportColumnKey[])
    : undefined;

  const html = stockReportPrintHtml(data, {
    audience: toStockReportAudience(sp.get('audience')),
    autoPrint: sp.get('print') !== '0',
    stockUnit: sp.get('stockUnit') === 'vials' ? 'vials' : 'boxes',
    showRemainder: sp.get('boxRemainder') !== '0',
    showCards: sp.get('cards') !== '0',
    showOnOrder: sp.get('onOrder') !== '0',
    columns,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
