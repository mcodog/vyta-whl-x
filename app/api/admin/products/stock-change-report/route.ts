import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  computeStockChangeReport,
  stockChangeReportPrintHtml,
} from '@/lib/admin/stock-change-report';

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
 * Stock Change Report — how stock moved over a date range (default: the
 * current week, Monday–Sunday). For each product that changed in the window
 * it shows Opening, units Sold, units Received, manual Adjustments, Net, and
 * Closing stock, derived from the append-only product_change_history ledger.
 *
 * The computation lives in `lib/admin/stock-change-report` so the printable
 * report and any future email/export stay in lock-step.
 */
export async function GET(request: NextRequest) {
  const role = await getRole(request);
  if (role !== 'admin' && role !== 'assistant' && role !== 'analytics') {
    return new NextResponse('Unauthorized', { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const data = await computeStockChangeReport(supabase, {
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    search: sp.get('q') ?? '',
    category: sp.get('category') ?? 'all',
  });

  const html = stockChangeReportPrintHtml(data, {
    autoPrint: sp.get('print') !== '0',
    stockUnit: sp.get('stockUnit') === 'vials' ? 'vials' : 'boxes',
    showRemainder: sp.get('boxRemainder') !== '0',
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
