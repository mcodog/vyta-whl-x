/**
 * Shared Stock Report computation + print rendering.
 *
 * The quantities-only (no-money) inventory view used by:
 *   - GET /api/admin/products/stock-report  (printable HTML report)
 *   - the scheduled report email (cron + "send now")
 *
 * Keeping the computation in one place means the printed report and the emailed
 * report can never drift apart.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reportShell,
  statsGrid,
  table,
  escapeHtml,
  formatStockDisplay,
  readableDateTime,
  type StockUnit,
} from '@/lib/admin/report-html';

/** PO statuses whose outstanding units count toward "On Order". */
export const ON_ORDER_STATUSES = new Set(['pending', 'partially_fulfilled']);

/** Human labels for the two statuses that feed On Order. */
export const PO_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  partially_fulfilled: 'Partially Fulfilled',
};

export interface StockReportRow {
  id: string;
  name: string;
  slug: string | null;
  sku: string | null;
  strength: string | null;
  category: string | null;
  active: boolean;
  stock: number;
  /** Vials per box, for expressing stock in boxes. */
  vialsPerBox: number;
  minQty: number;
  onOrder: number;
  needToOrder: number;
}

export interface ContributingPo {
  poNumber: string;
  status: string;
  units: number;
}

export interface StockReportTotals {
  products: number;
  active: number;
  units: number;
  onOrder: number;
  needToOrder: number;
  needCount: number;
  outOfStock: number;
  lowStock: number;
}

export interface StockReportData {
  rows: StockReportRow[];
  totals: StockReportTotals;
  contributingPos: ContributingPo[];
  filters: string[];
}

export interface StockReportFilters {
  search?: string;
  category?: string;
  status?: string; // all | active | inactive
}

/** Toggleable columns on the Stock Report table, in report order. */
export type StockReportColumnKey =
  | 'sku'
  | 'description'
  | 'strength'
  | 'stock'
  | 'minQty'
  | 'onOrder'
  | 'needToOrder';

/** Every stock-report column key, in report order (the default selection). */
export const STOCK_REPORT_COLUMN_KEYS: StockReportColumnKey[] = [
  'sku',
  'description',
  'strength',
  'stock',
  'minQty',
  'onOrder',
  'needToOrder',
];

/**
 * Who the report is written for.
 *
 * `internal` is the full report. `customer` is the copy you can hand to a
 * customer: identical figures, minus everything that describes how we buy —
 * the minimum quantity we hold, what is on order, and what we still need to
 * order. Those are our purchasing posture, not their availability.
 */
export type StockReportAudience = 'internal' | 'customer';

/**
 * The only columns a customer copy may contain. The audience filter is applied
 * as an intersection, so a column the operator switched off stays off — the
 * audience can only ever remove columns, never add one back.
 */
export const CUSTOMER_STOCK_REPORT_COLUMN_KEYS: StockReportColumnKey[] = [
  'sku',
  'description',
  'strength',
  'stock',
];

/** Coerce an arbitrary value to a supported audience (internal by default). */
export function toStockReportAudience(v: unknown): StockReportAudience {
  return v === 'customer' ? 'customer' : 'internal';
}

/**
 * Load products + open purchase-order items and derive the stock-report figures
 * (stock, min quantity, on order, need to order) for each displayed product.
 */
export async function computeStockReport(
  db: SupabaseClient,
  opts: StockReportFilters = {},
): Promise<StockReportData> {
  const search = (opts.search ?? '').toLowerCase();
  const categoryFilter = opts.category ?? 'all';
  const statusFilter = opts.status ?? 'all';

  const [{ data: products }, { data: poItems }] = await Promise.all([
    db.from('products').select('*').order('name', { ascending: true }),
    // On-order = outstanding units from purchase orders that aren't fully
    // received yet. Only pending / partially fulfilled POs contribute; any
    // already-received quantity is excluded (it's already in stock_quantity).
    db
      .from('purchase_order_items')
      .select('product_id, qty, qty_received, purchase_order:purchase_orders (id, po_number, status)'),
  ]);

  const filtered = (products ?? []).filter((p: any) => {
    if (search) {
      const hay = `${p.name ?? ''} ${p.category ?? ''} ${p.strength ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (statusFilter === 'active' && p.active === false) return false;
    if (statusFilter === 'inactive' && p.active !== false) return false;
    return true;
  });
  // Only tally On Order for the products actually shown, so the note and the
  // column totals stay consistent when filters are applied.
  const displayedIds = new Set(filtered.map((p: any) => String(p.id)));

  const onOrderById = new Map<string, number>();
  const contributing = new Map<string, ContributingPo>();
  for (const it of poItems ?? []) {
    if (!it.product_id) continue;
    const key = String(it.product_id);
    if (!displayedIds.has(key)) continue;
    const po = (it as any).purchase_order;
    if (!po || !ON_ORDER_STATUSES.has(po.status)) continue;
    const outstanding = Math.max(0, (Number(it.qty) || 0) - (Number(it.qty_received) || 0));
    if (outstanding <= 0) continue;
    onOrderById.set(key, (onOrderById.get(key) ?? 0) + outstanding);
    const poKey = String(po.id);
    const entry = contributing.get(poKey) ?? {
      poNumber: po.po_number ?? '—',
      status: po.status,
      units: 0,
    };
    entry.units += outstanding;
    contributing.set(poKey, entry);
  }

  const rows: StockReportRow[] = filtered.map((p: any) => {
    const stock = Number(p.stock_quantity) || 0;
    const minQty = Number(p.low_stock_threshold) || 0;
    const onOrder = onOrderById.get(String(p.id)) ?? 0;
    return {
      id: String(p.id),
      name: p.name ?? '—',
      slug: p.slug ?? null,
      sku: p.sku ?? null,
      strength: p.strength ?? null,
      category: p.category ?? null,
      active: p.active !== false,
      stock,
      vialsPerBox: Number(p.vials_per_box) || 0,
      minQty,
      onOrder,
      // Need to order = minQty - (stock + onOrder), floored at zero.
      needToOrder: Math.max(0, minQty - (stock + onOrder)),
    };
  });

  const totals: StockReportTotals = {
    products: rows.length,
    active: rows.filter((r) => r.active).length,
    units: rows.reduce((s, r) => s + r.stock, 0),
    onOrder: rows.reduce((s, r) => s + r.onOrder, 0),
    needToOrder: rows.reduce((s, r) => s + r.needToOrder, 0),
    needCount: rows.filter((r) => r.needToOrder > 0).length,
    outOfStock: rows.filter((r) => r.stock <= 0).length,
    lowStock: rows.filter((r) => r.stock > 0 && r.minQty > 0 && r.stock <= r.minQty).length,
  };

  const contributingPos = Array.from(contributing.values()).sort((a, b) =>
    a.poNumber.localeCompare(b.poNumber),
  );

  const filters: string[] = [];
  if (opts.search) filters.push(`Search: "${opts.search}"`);
  if (categoryFilter !== 'all') filters.push(`Category: ${categoryFilter}`);
  if (statusFilter !== 'all') filters.push(`Status: ${statusFilter}`);
  if (filters.length === 0) filters.push('None — all products');

  return { rows, totals, contributingPos, filters };
}

/**
 * Stock quantity as plain text for the print report — the quantity is shown in
 * the chosen unit (boxes/vials) so the cell always names what it is counting.
 * The Stock Report deliberately skips the green/amber status pills (low-stock
 * is already conveyed by the Min Quantity / Need To Order columns).
 */
function stockText(r: StockReportRow, unit: StockUnit, showRemainder: boolean): string {
  if (r.stock <= 0) return 'Out of stock';
  return formatStockDisplay(r.stock, r.vialsPerBox, unit, showRemainder);
}

/** The explanatory "How On Order is calculated" note + contributing-PO list. */
function onOrderNoteHtml(data: StockReportData): string {
  const poListHtml =
    data.contributingPos.length > 0
      ? data.contributingPos
          .map(
            (po) =>
              `<li><span class="mono">${escapeHtml(po.poNumber)}</span> — ${escapeHtml(
                PO_STATUS_LABEL[po.status] ?? po.status,
              )} · <strong>${po.units}</strong> unit${po.units === 1 ? '' : 's'}</li>`,
          )
          .join('')
      : '<li>No open purchase orders are currently contributing to On Order.</li>';

  return `
    <div class="filters" style="margin-top:22px;">
      <strong>How “On Order” is calculated</strong>
      <p style="margin:8px 0 0; font-size:11.5px; line-height:1.55; color:#374151;">
        <em>On Order</em> counts the units still to be received (ordered − already
        received) from purchase orders that are <strong>Pending</strong> or
        <strong>Partially Fulfilled</strong>. Fulfilled, paid, and cancelled orders
        are excluded. <em>Need To Order</em> = Min Quantity − (Stock + On Order),
        and is never below 0.
      </p>
      <p style="margin:10px 0 4px; font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#6E6E6E;">
        Purchase orders considered (${data.contributingPos.length})
      </p>
      <ul style="margin:0; padding-left:18px; font-size:11.5px; line-height:1.6; color:#374151;">
        ${poListHtml}
      </ul>
    </div>
  `;
}

/** Full printable (auto-printing) Stock Report HTML document. */
export function stockReportPrintHtml(
  data: StockReportData,
  opts: {
    autoPrint?: boolean;
    stockUnit?: StockUnit;
    showRemainder?: boolean;
    /** Show the summary cards row. Default true. */
    showCards?: boolean;
    /** Show the "How On Order is calculated" footer note. Default true. */
    showOnOrder?: boolean;
    /**
     * Which table columns to include, in report order. Omitted/empty means all
     * columns (the default report).
     */
    columns?: StockReportColumnKey[];
    /**
     * Who the report is for. `customer` strips every purchasing detail — the
     * Min Quantity / On Order / Need To Order columns, their summary cards, and
     * the "How On Order is calculated" note — leaving availability only.
     * Default `internal`.
     */
    audience?: StockReportAudience;
  } = {},
): string {
  const { totals } = data;
  const unit: StockUnit = opts.stockUnit === 'vials' ? 'vials' : 'boxes';
  const showRemainder = opts.showRemainder ?? true;
  const showCards = opts.showCards ?? true;
  const audience = toStockReportAudience(opts.audience);
  const forCustomer = audience === 'customer';
  // The on-order note explains our purchasing to whoever reads it, so a
  // customer copy never carries it whatever was requested.
  const showOnOrder = forCustomer ? false : opts.showOnOrder ?? true;

  // Resolve the requested column selection (fall back to all columns), keeping
  // them in the canonical report order regardless of the input order. A
  // customer copy then intersects that with the columns it is allowed to show,
  // so the audience can only ever remove a column, never restore one.
  const selected = opts.columns && opts.columns.length > 0 ? opts.columns : STOCK_REPORT_COLUMN_KEYS;
  const requested = new Set(
    forCustomer
      ? selected.filter((c) => CUSTOMER_STOCK_REPORT_COLUMN_KEYS.includes(c))
      : selected,
  );

  // Each column knows its header cell and how to render a row cell, so the
  // header row and body stay in lock-step as columns are toggled on/off.
  const columnDefs: {
    key: StockReportColumnKey;
    header: { header: string; num?: boolean };
    cell: (r: StockReportRow) => string;
  }[] = [
    { key: 'sku', header: { header: 'SKU' }, cell: (r) => `<span class="mono">${escapeHtml(r.slug || r.sku || '—')}</span>` },
    { key: 'description', header: { header: 'Description' }, cell: (r) => escapeHtml(r.name) },
    { key: 'strength', header: { header: 'Strength' }, cell: (r) => escapeHtml(r.strength || '—') },
    { key: 'stock', header: { header: `Stock (${unit})` }, cell: (r) => stockText(r, unit, showRemainder) },
    { key: 'minQty', header: { header: 'Min Quantity', num: true }, cell: (r) => String(r.minQty) },
    { key: 'onOrder', header: { header: 'On Order', num: true }, cell: (r) => String(r.onOrder) },
    { key: 'needToOrder', header: { header: 'Need To Order', num: true }, cell: (r) => String(r.needToOrder) },
  ];

  const activeColumns = columnDefs.filter((c) => requested.has(c.key));
  const tableHeaders = activeColumns.map((c) => c.header);
  const tableRows = data.rows.map((r) => activeColumns.map((c) => c.cell(r)));

  // The last two cards are the same purchasing detail as the columns they
  // summarise, so a customer copy shows only what's in the catalogue and what's
  // on the shelf.
  const cards = [
    { label: 'Products', value: String(totals.products), meta: `${totals.active} active` },
    { label: 'Stock On Hand', value: `${totals.units} units`, meta: `${totals.lowStock} low · ${totals.outOfStock} out` },
    ...(forCustomer
      ? []
      : [
          { label: 'On Order', value: `${totals.onOrder} units`, meta: 'open purchase orders' },
          { label: 'Need To Order', value: `${totals.needToOrder} units`, meta: `${totals.needCount} product${totals.needCount === 1 ? '' : 's'}`, tone: totals.needToOrder > 0 ? ('danger' as const) : ('default' as const) },
        ]),
  ];
  const cardsHtml = showCards ? statsGrid(cards) : '';

  const body = `
    ${cardsHtml}
    <h2>Stock levels (${totals.products})</h2>
    ${table(
      tableHeaders,
      tableRows,
      'No products match the filters.',
    )}
    ${showOnOrder ? onOrderNoteHtml(data) : ''}
  `;

  return reportShell({
    title: 'Stock Report',
    branded: true,
    meta: [
      `Generated ${readableDateTime()}`,
      `${totals.products} product${totals.products === 1 ? '' : 's'}`,
      `Stock in ${unit}`,
    ],
    // The Stock Report intentionally omits the top "Filters" card.
    body,
    footRight: `${totals.products} product${totals.products === 1 ? '' : 's'}`,
    autoPrint: opts.autoPrint ?? true,
  });
}
