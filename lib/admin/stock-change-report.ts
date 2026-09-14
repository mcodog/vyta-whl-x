/**
 * Shared Stock Change Report computation + print rendering.
 *
 * Where the Stock Report (lib/admin/stock-report) shows a point-in-time
 * snapshot of current stock, this report answers a different question:
 * **how did stock move over a date range?** For each product it reads the
 * append-only `product_change_history` ledger (field = 'stock_quantity')
 * within the window and derives:
 *   - Opening   — stock right before the first change in the window
 *   - Sold      — units removed by sales (order + invoice decrements)
 *   - Received  — units added by purchase-order receipts (restock)
 *   - Adjusted  — net of manual/other edits (form, inline, import, revert,
 *                 api, invoice_cancel, create) — signed
 *   - Net       — Closing − Opening
 *   - Closing   — stock after the last change in the window
 *
 * The default window is the current week (Monday–Sunday). Because every
 * stock change writes an old→new row, opening/closing derived from the
 * first/last rows in the window are exact.
 *
 * Used by GET /api/admin/products/stock-change-report (printable HTML).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reportShell,
  statsGrid,
  table,
  pill,
  escapeHtml,
  formatStockDisplay,
  readableDateTime,
  type StockUnit,
} from '@/lib/admin/report-html';

/** Change sources that represent a sale (stock leaving). */
const SOLD_SOURCES = new Set(['order', 'invoice']);
/** Change sources that represent inbound stock (purchase-order receipt). */
const RECEIVED_SOURCES = new Set(['restock']);
// Everything else (create, inline, form, import, revert, api, invoice_cancel)
// is treated as a manual/other adjustment and counted as a signed net.

export interface StockChangeRow {
  id: string;
  name: string;
  slug: string | null;
  sku: string | null;
  strength: string | null;
  category: string | null;
  active: boolean;
  /** Vials per box, for expressing opening/closing stock in boxes. */
  vialsPerBox: number;
  opening: number;
  sold: number; // units sold (positive)
  received: number; // units received (positive)
  adjusted: number; // net manual adjustment (signed)
  net: number; // closing - opening (signed)
  closing: number;
  changes: number; // number of ledger rows in the window
}

export interface StockChangeTotals {
  productsChanged: number;
  sold: number;
  received: number;
  adjusted: number;
  net: number;
  changes: number;
}

export interface StockChangeData {
  rows: StockChangeRow[];
  totals: StockChangeTotals;
  from: string; // YYYY-MM-DD (inclusive)
  to: string; // YYYY-MM-DD (inclusive)
  rangeLabel: string;
  filters: string[];
}

export interface StockChangeFilters {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  search?: string;
  category?: string;
}

/** Pad to two digits. */
const p2 = (n: number): string => String(n).padStart(2, '0');

/** Format a Date as a local YYYY-MM-DD string (no timezone shift). */
export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * The current week as [Monday, Sunday] date-input strings. Weeks run
 * Monday→Sunday to match how the warehouse thinks about a "week".
 */
export function currentWeekRange(now: Date = new Date()): { from: string; to: string } {
  const day = now.getDay(); // 0=Sun … 6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day; // Sunday counts as the prior Monday's week
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: toDateInput(monday), to: toDateInput(sunday) };
}

/** Validate a YYYY-MM-DD string; returns null if malformed. */
function parseDateInput(v: string | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const dt = new Date(`${v}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : v;
}

/** Human label for the range, e.g. "Jul 13 – Jul 19, 2026". */
function rangeLabel(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const fStr = f.toLocaleDateString('en-US', opts);
  const tStr = t.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${fStr} – ${tStr}`;
}

/**
 * Load stock-change history within [from, to] (inclusive days) and derive the
 * per-product movement figures. Products with no stock change in the window
 * are omitted (this report is about what moved).
 */
export async function computeStockChangeReport(
  db: SupabaseClient,
  opts: StockChangeFilters = {},
): Promise<StockChangeData> {
  const week = currentWeekRange();
  let from = parseDateInput(opts.from) ?? week.from;
  let to = parseDateInput(opts.to) ?? week.to;
  // Guard against a reversed range (swap so from <= to).
  if (from > to) [from, to] = [to, from];

  const search = (opts.search ?? '').toLowerCase();
  const categoryFilter = opts.category ?? 'all';

  // [from 00:00, to+1day 00:00) — inclusive of the whole "to" day.
  const startIso = new Date(`${from}T00:00:00`).toISOString();
  const endExclusive = new Date(`${to}T00:00:00`);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const endIso = endExclusive.toISOString();

  const { data: history } = await db
    .from('product_change_history')
    .select(
      'product_id, old_value, new_value, change_source, created_at, product:products (id, name, slug, sku, strength, category, active, vials_per_box)',
    )
    .eq('field', 'stock_quantity')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: true });

  // Group ledger rows by product (already time-ordered ascending).
  interface Acc {
    product: any;
    opening: number | null;
    closing: number;
    sold: number;
    received: number;
    adjusted: number;
    changes: number;
  }
  const byProduct = new Map<string, Acc>();

  for (const h of history ?? []) {
    if (!h.product_id) continue;
    const product = (h as any).product;
    if (!product) continue; // product deleted — skip orphaned history
    const key = String(h.product_id);
    const oldV = h.old_value === null ? 0 : Number(h.old_value) || 0;
    const newV = Number(h.new_value) || 0;
    const delta = newV - oldV;

    let acc = byProduct.get(key);
    if (!acc) {
      // Opening is the stock right before the first change in the window.
      acc = { product, opening: oldV, closing: newV, sold: 0, received: 0, adjusted: 0, changes: 0 };
      byProduct.set(key, acc);
    }
    acc.closing = newV; // rows are ascending, so the last one wins
    acc.changes += 1;

    if (SOLD_SOURCES.has(h.change_source)) {
      acc.sold += Math.max(0, -delta);
    } else if (RECEIVED_SOURCES.has(h.change_source)) {
      acc.received += Math.max(0, delta);
    } else {
      acc.adjusted += delta;
    }
  }

  let rows: StockChangeRow[] = Array.from(byProduct.entries()).map(([id, a]) => {
    const opening = a.opening ?? 0;
    return {
      id,
      name: a.product.name ?? '—',
      slug: a.product.slug ?? null,
      sku: a.product.sku ?? null,
      strength: a.product.strength ?? null,
      category: a.product.category ?? null,
      active: a.product.active !== false,
      vialsPerBox: Number(a.product.vials_per_box) || 0,
      opening,
      sold: a.sold,
      received: a.received,
      adjusted: a.adjusted,
      net: a.closing - opening,
      closing: a.closing,
      changes: a.changes,
    };
  });

  // Apply search / category filters after aggregation.
  rows = rows.filter((r) => {
    if (search) {
      const hay = `${r.name} ${r.category ?? ''} ${r.strength ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
    return true;
  });

  // Most-active first (by number of changes), then by name.
  rows.sort((a, b) => b.changes - a.changes || a.name.localeCompare(b.name));

  const totals: StockChangeTotals = {
    productsChanged: rows.length,
    sold: rows.reduce((s, r) => s + r.sold, 0),
    received: rows.reduce((s, r) => s + r.received, 0),
    adjusted: rows.reduce((s, r) => s + r.adjusted, 0),
    net: rows.reduce((s, r) => s + r.net, 0),
    changes: rows.reduce((s, r) => s + r.changes, 0),
  };

  const filters: string[] = [`Date range: ${rangeLabel(from, to)}`];
  if (opts.search) filters.push(`Search: "${opts.search}"`);
  if (categoryFilter !== 'all') filters.push(`Category: ${categoryFilter}`);

  return { rows, totals, from, to, rangeLabel: rangeLabel(from, to), filters };
}

/** Signed number as a coloured pill: +N green, −N red, 0 plain. */
function signedPill(n: number): string {
  if (n > 0) return pill(`+${n}`, 'green');
  if (n < 0) return pill(String(n), 'red');
  return '0';
}

/** Full printable (auto-printing) Stock Change Report HTML document. */
export function stockChangeReportPrintHtml(
  data: StockChangeData,
  opts: { autoPrint?: boolean; stockUnit?: StockUnit; showRemainder?: boolean } = {},
): string {
  const { totals } = data;
  const unit: StockUnit = opts.stockUnit === 'vials' ? 'vials' : 'boxes';
  const showRemainder = opts.showRemainder ?? true;

  const tableRows = data.rows.map((r) => [
    `<span class="mono">${escapeHtml(r.slug || r.sku || '—')}</span>`,
    escapeHtml(r.name),
    escapeHtml(r.strength || '—'),
    formatStockDisplay(r.opening, r.vialsPerBox, unit, showRemainder),
    r.sold > 0 ? pill(`−${r.sold}`, 'red') : '0',
    r.received > 0 ? pill(`+${r.received}`, 'green') : '0',
    r.adjusted !== 0 ? signedPill(r.adjusted) : '0',
    signedPill(r.net),
    `<strong>${formatStockDisplay(r.closing, r.vialsPerBox, unit, showRemainder)}</strong>`,
  ]);

  const body = `
    ${statsGrid([
      { label: 'Products Changed', value: String(totals.productsChanged), meta: `${totals.changes} change${totals.changes === 1 ? '' : 's'}` },
      { label: 'Units Sold', value: String(totals.sold), meta: 'orders + invoices' },
      { label: 'Units Received', value: String(totals.received), meta: 'PO receipts' },
      { label: 'Net Change', value: `${totals.net > 0 ? '+' : ''}${totals.net}`, meta: `${totals.adjusted > 0 ? '+' : ''}${totals.adjusted} adjustments`, tone: totals.net < 0 ? 'danger' : 'default' },
    ])}
    <h2>Stock movement (${totals.productsChanged})</h2>
    ${table(
      [
        { header: 'SKU' },
        { header: 'Description' },
        { header: 'Strength' },
        { header: `Opening (${unit})` },
        { header: 'Sold', num: true },
        { header: 'Received', num: true },
        { header: 'Adjusted', num: true },
        { header: 'Net', num: true },
        { header: `Closing (${unit})`, num: true },
      ],
      tableRows,
      'No stock changes in this date range.',
    )}
    <div class="filters" style="margin-top:22px;">
      <strong>How this report is calculated</strong>
      <p style="margin:8px 0 0; font-size:11.5px; line-height:1.55; color:#374151;">
        Figures cover stock changes recorded between the selected dates.
        <em>Opening</em> is the stock right before the first change in the range;
        <em>Closing</em> is the stock after the last. <em>Sold</em> counts units
        removed by orders and paid invoices; <em>Received</em> counts units added
        by purchase-order receipts; <em>Adjusted</em> is the net of manual edits,
        imports, reverts, and invoice cancellations. <em>Net</em> = Closing −
        Opening. Opening and Closing are shown in ${unit}; movement figures
        (Sold, Received, Adjusted, Net) are counted in vials. Products with no
        change in the range are omitted.
      </p>
    </div>
  `;

  return reportShell({
    title: 'Stock Change Report',
    branded: true,
    meta: [
      `Generated ${readableDateTime()}`,
      data.rangeLabel,
      `${totals.productsChanged} product${totals.productsChanged === 1 ? '' : 's'} changed`,
      `Opening / closing in ${unit}`,
    ],
    filters: data.filters,
    body,
    footRight: `${totals.productsChanged} product${totals.productsChanged === 1 ? '' : 's'} · ${data.rangeLabel}`,
    autoPrint: opts.autoPrint ?? true,
  });
}
