import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  reportShell,
  statsGrid,
  table,
  pill,
  money,
  escapeHtml,
  formatStockDisplay,
  readableDateTime,
  type Stat,
  type StockUnit,
} from '@/lib/admin/report-html';

/** Summary cards available in the report, in display order. */
const ALL_CARDS = ['products', 'stock', 'lowout', 'revenue'] as const;
/**
 * Table columns available in the report, in display order. The identity
 * columns lead: SKU (the product slug) then Description. Category was retired.
 */
const ALL_COLS = [
  'sku',
  'product',
  'strength',
  'price',
  'stock',
  'stockValue',
  'unitsSold',
  'revenue',
  'status',
] as const;

/** Money-bearing columns/cards — gated together by the "Revenue & Pricing" group. */
const PRICING_COLS = new Set(['price', 'stockValue', 'revenue']);

/**
 * Parse a comma-separated "cards"/"cols" selection param into a set of known
 * keys. A missing param (null) means "show everything" — keeps the report
 * backward-compatible for callers that don't customize it.
 */
function parseSelection<T extends string>(raw: string | null, all: readonly T[]): Set<T> {
  if (raw === null) return new Set(all);
  const allowed = new Set<string>(all);
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((k): k is T => allowed.has(k)),
  );
}

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
  if (role !== 'admin' && role !== 'assistant' && role !== 'analytics') {
    return new NextResponse('Unauthorized', { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const search = (sp.get('q') ?? '').toLowerCase();
  const categoryFilter = sp.get('category') ?? 'all';
  const statusFilter = sp.get('status') ?? 'all'; // all | active | inactive
  // Stock-status filter — limit the report to low and/or out-of-stock items.
  // all | low | out | lowout (low OR out). Absent = every product.
  const stockStatusFilter = sp.get('stockStatus') ?? 'all';

  // Which summary cards / table columns to render. Controlled by the
  // "Customize Report" modal on the products page; absent = show all.
  const selCards = parseSelection(sp.get('cards'), ALL_CARDS);
  let selCols = parseSelection(sp.get('cols'), ALL_COLS);
  // Never render a table with zero columns — fall back to the full set.
  if (selCols.size === 0) selCols = new Set(ALL_COLS);

  // Whether any money figure is on the report — drives the currency note and
  // the Stock On Hand card's stock-value meta (the "outlier" money sub-figure).
  const showsPricing = selCards.has('revenue') || [...selCols].some((c) => PRICING_COLS.has(c));

  // Stock column display: boxes (default) or vials. When showing boxes, any
  // leftover vials appear as a subscript unless the caller opts out.
  const stockUnit: StockUnit = sp.get('stockUnit') === 'vials' ? 'vials' : 'boxes';
  const showRemainder = sp.get('boxRemainder') !== '0';

  // ---- Pricing source ------------------------------------------------------
  // The current-price figures on the report (the Price column and Stock Value)
  // default to the catalog price (products.price). The caller can instead price
  // them from a saved *general* price list, or from a specific customer's
  // *dedicated* price list (their price overrides). Any product the chosen list
  // doesn't set keeps its catalog price, so the report is always complete.
  // Revenue is deliberately left untouched — it's historical sales at the price
  // that was actually charged, not a figure to reprice.
  //   priceSource = 'default'   → catalog prices (products.price)
  //   priceSource = 'pricelist' → general price list (needs pricelistId)
  //   priceSource = 'customer'  → a customer's dedicated prices (needs customerId)
  //   priceSource = 'affiliate' → an affiliate's price list (needs affiliateId)
  const priceSource = sp.get('priceSource') ?? 'default';
  const pricelistId = sp.get('pricelistId');
  const customerId = sp.get('customerId');
  const affiliateId = sp.get('affiliateId');

  const [{ data: products }, { data: orderItems }] = await Promise.all([
    supabase.from('products').select('*').order('name', { ascending: true }),
    supabase.from('order_items').select('product_id, product_name, quantity, price_at_time'),
  ]);

  // Resolve the per-product price overrides for the chosen source. `priceMap`
  // stays null for the catalog default (priceOf then falls straight through to
  // products.price). Currency drives the "Pricing in …" note only — amounts are
  // never converted here; a USD list simply stores USD numbers.
  let priceMap: Map<string, number> | null = null;
  let priceSourceLabel: string | null = null;
  let priceCurrency: 'CAD' | 'USD' = 'CAD';

  if (priceSource === 'pricelist' && pricelistId) {
    const [{ data: pl }, { data: plItems }] = await Promise.all([
      supabase.from('pricelists').select('name, currency').eq('id', pricelistId).maybeSingle(),
      supabase.from('pricelist_items').select('product_id, price').eq('pricelist_id', pricelistId),
    ]);
    if (pl) {
      priceMap = new Map(
        (plItems ?? []).map((i: any) => [String(i.product_id), Number(i.price) || 0]),
      );
      priceSourceLabel = `Price list: ${pl.name}`;
      priceCurrency = pl.currency === 'USD' ? 'USD' : 'CAD';
    }
  } else if (priceSource === 'customer' && customerId) {
    const [{ data: cust }, { data: overrides }] = await Promise.all([
      supabase
        .from('customers')
        .select(
          'first_name, last_name, email, price_currency, applied_pricelist:pricelists!customers_applied_pricelist_id_fkey(currency)',
        )
        .eq('id', customerId)
        .maybeSingle(),
      supabase
        .from('customer_price_overrides')
        .select('product_id, override_price')
        .eq('customer_id', customerId),
    ]);
    if (cust) {
      priceMap = new Map(
        (overrides ?? []).map((o: any) => [String(o.product_id), Number(o.override_price) || 0]),
      );
      const nm = [cust.first_name, cust.last_name].filter(Boolean).join(' ') || cust.email;
      priceSourceLabel = `Customer price list: ${nm}`;
      // The customer's applied price list is authoritative for the currency of
      // the override numbers (it's what generated them); its currency wins over
      // the price_currency tag, which can lag behind when a list was applied
      // before the tag was synced.
      const listCur = (cust as any).applied_pricelist?.currency;
      priceCurrency =
        listCur === 'USD' ? 'USD' : listCur === 'CAD' ? 'CAD' : cust.price_currency === 'USD' ? 'USD' : 'CAD';
    }
  } else if (priceSource === 'affiliate' && affiliateId) {
    // An affiliate's price list drives every bound customer's prices (ADR 0004).
    // The affiliate shares its id with a customers row, whose price_currency tags
    // the currency of these override numbers.
    const [{ data: aff }, { data: overrides }, { data: affCust }] = await Promise.all([
      supabase.from('affiliates').select('first_name, last_name, email').eq('id', affiliateId).maybeSingle(),
      supabase
        .from('affiliate_price_overrides')
        .select('product_id, override_price')
        .eq('affiliate_id', affiliateId),
      supabase.from('customers').select('price_currency').eq('id', affiliateId).maybeSingle(),
    ]);
    if (aff) {
      priceMap = new Map(
        (overrides ?? []).map((o: any) => [String(o.product_id), Number(o.override_price) || 0]),
      );
      const nm = [aff.first_name, aff.last_name].filter(Boolean).join(' ') || aff.email;
      priceSourceLabel = `Affiliate price list: ${nm}`;
      priceCurrency = affCust?.price_currency === 'USD' ? 'USD' : 'CAD';
    }
  }

  /** Effective unit price for a product under the selected pricing source. */
  const priceOf = (p: any): number =>
    priceMap?.get(String(p.id)) ?? (Number(p.price) || 0);

  // Sales per product (matched by product_id, falling back to name).
  const salesById = new Map<string, { units: number; revenue: number }>();
  const salesByName = new Map<string, { units: number; revenue: number }>();
  for (const oi of orderItems ?? []) {
    const units = Number(oi.quantity) || 0;
    const revenue = units * (Number(oi.price_at_time) || 0);
    if (oi.product_id) {
      const e = salesById.get(String(oi.product_id)) ?? { units: 0, revenue: 0 };
      e.units += units;
      e.revenue += revenue;
      salesById.set(String(oi.product_id), e);
    }
    if (oi.product_name) {
      const e = salesByName.get(oi.product_name) ?? { units: 0, revenue: 0 };
      e.units += units;
      e.revenue += revenue;
      salesByName.set(oi.product_name, e);
    }
  }
  const salesFor = (p: any) =>
    salesById.get(String(p.id)) ?? salesByName.get(p.name) ?? { units: 0, revenue: 0 };

  let rows = (products ?? []).filter((p: any) => {
    if (search) {
      const hay = `${p.name ?? ''} ${p.category ?? ''} ${p.strength ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (statusFilter === 'active' && p.active === false) return false;
    if (statusFilter === 'inactive' && p.active !== false) return false;
    if (stockStatusFilter !== 'all') {
      const q = Number(p.stock_quantity) || 0;
      const t = Number(p.low_stock_threshold) || 10;
      const isOut = q <= 0;
      const isLow = q > 0 && q <= t;
      if (stockStatusFilter === 'out' && !isOut) return false;
      if (stockStatusFilter === 'low' && !isLow) return false;
      if (stockStatusFilter === 'lowout' && !isLow && !isOut) return false;
    }
    return true;
  });

  const totalProducts = rows.length;
  const activeCount = rows.filter((p: any) => p.active !== false).length;
  const totalUnits = rows.reduce((s: number, p: any) => s + (Number(p.stock_quantity) || 0), 0);
  const stockValue = rows.reduce(
    (s: number, p: any) => s + (Number(p.stock_quantity) || 0) * priceOf(p),
    0,
  );
  const outOfStock = rows.filter((p: any) => (Number(p.stock_quantity) || 0) <= 0).length;
  const lowStock = rows.filter((p: any) => {
    const q = Number(p.stock_quantity) || 0;
    const t = Number(p.low_stock_threshold) || 10;
    return q > 0 && q <= t;
  }).length;
  const totalRevenue = rows.reduce((s: number, p: any) => s + salesFor(p).revenue, 0);

  // Stock pill: colour by low/out status, quantity shown in the chosen unit
  // (boxes/vials) so a printed report always names what it's counting.
  const stockPill = (p: any) => {
    const q = Number(p.stock_quantity) || 0;
    const t = Number(p.low_stock_threshold) || 10;
    const disp = formatStockDisplay(q, Number(p.vials_per_box) || 0, stockUnit, showRemainder);
    if (q <= 0) return `<span class="pill out">Out of stock</span>`;
    if (q <= t) return `<span class="pill amber">Low · ${disp}</span>`;
    return `<span class="pill green">${disp}</span>`;
  };

  const stockHeader = `Stock (${stockUnit})`;

  // Per-column definitions: header, alignment, and a cell renderer. Only the
  // columns selected in `selCols` end up in the rendered table.
  const colDefs: Record<
    (typeof ALL_COLS)[number],
    { header: string; num?: boolean; cell: (p: any, sales: { units: number; revenue: number }) => string }
  > = {
    // SKU shows the product slug (the human-facing identifier).
    sku: { header: 'SKU', cell: (p) => `<span class="mono">${escapeHtml(p.slug || p.sku || '—')}</span>` },
    product: { header: 'Description', cell: (p) => escapeHtml(p.name ?? '—') },
    strength: { header: 'Strength', cell: (p) => escapeHtml(p.strength || '—') },
    price: { header: 'Price', num: true, cell: (p) => money(priceOf(p)) },
    stock: { header: stockHeader, cell: (p) => stockPill(p) },
    stockValue: {
      header: 'Stock Value',
      num: true,
      cell: (p) => money((Number(p.stock_quantity) || 0) * priceOf(p)),
    },
    unitsSold: { header: 'Units Sold', num: true, cell: (_p, sales) => String(sales.units) },
    revenue: { header: 'Revenue', num: true, cell: (_p, sales) => money(sales.revenue) },
    status: {
      header: 'Status',
      cell: (p) => (p.active === false ? pill('Inactive', 'inactive') : pill('Active', 'active')),
    },
  };

  const activeCols = ALL_COLS.filter((k) => selCols.has(k));
  const columns = activeCols.map((k) => ({ header: colDefs[k].header, num: colDefs[k].num }));
  const tableRows = rows.map((p: any) => {
    const sales = salesFor(p);
    return activeCols.map((k) => colDefs[k].cell(p, sales));
  });

  // Human labels for the stock-status filter, reused in the heading & filters.
  const STOCK_STATUS_LABEL: Record<string, string> = {
    low: 'Low stock only',
    out: 'Out of stock only',
    lowout: 'Low or out of stock',
  };

  const filters: string[] = [];
  if (search) filters.push(`Search: "${search}"`);
  if (categoryFilter !== 'all') filters.push(`Category: ${categoryFilter}`);
  if (statusFilter !== 'all') filters.push(`Status: ${statusFilter}`);
  if (stockStatusFilter !== 'all') {
    filters.push(`Stock: ${STOCK_STATUS_LABEL[stockStatusFilter] ?? stockStatusFilter}`);
  }
  // Surface the pricing source whenever the report carries money and it isn't
  // the plain catalog default, so a printed copy names where its prices came from.
  if (showsPricing && priceSourceLabel) filters.push(priceSourceLabel);
  if (filters.length === 0) filters.push('None — all products');

  // Selected summary cards, in the canonical display order.
  // Stock On Hand is an inventory card, but its stock-value meta is a money
  // figure — so it only appears when the report is showing pricing.
  const cardDefs: Record<(typeof ALL_CARDS)[number], Stat> = {
    products: { label: 'Products', value: String(totalProducts), meta: `${activeCount} active` },
    stock: {
      label: 'Stock On Hand',
      value: `${totalUnits} units`,
      meta: showsPricing ? `${money(stockValue)} value` : undefined,
    },
    lowout: { label: 'Low / Out', value: `${lowStock} / ${outOfStock}`, tone: outOfStock > 0 ? 'danger' : 'default' },
    revenue: { label: 'Revenue (All Time)', value: money(totalRevenue), tone: 'paid' },
  };
  const stats = ALL_CARDS.filter((k) => selCards.has(k)).map((k) => cardDefs[k]);

  const heading =
    stockStatusFilter === 'all'
      ? 'All products'
      : STOCK_STATUS_LABEL[stockStatusFilter] ?? 'Products';

  const body = `
    ${stats.length > 0 ? statsGrid(stats) : ''}
    <h2>${heading} (${totalProducts})</h2>
    ${table(columns, tableRows, 'No products match the filters.')}
  `;

  const meta = [
    `Generated ${readableDateTime()}`,
    `${totalProducts} product${totalProducts === 1 ? '' : 's'}`,
    `Stock in ${stockUnit}`,
  ];
  if (showsPricing) meta.push(`Pricing in ${priceCurrency}`);

  const html = reportShell({
    title: 'Products Report',
    branded: true,
    meta,
    filters,
    body,
    footRight: `${totalProducts} product${totalProducts === 1 ? '' : 's'}`,
    autoPrint: sp.get('print') !== '0',
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
