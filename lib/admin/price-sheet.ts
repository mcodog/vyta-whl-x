/**
 * Per-entity price-sheet report (customer or sales person).
 *
 * Produces a clean, branded, print-ready price list for a single customer or
 * sales person: SKU, Description, Case price, Vial price, and — when requested
 * — an Inventory column showing the exact on-hand stock. The document
 * auto-prints so the browser's "Save as PDF" turns it into a shareable file.
 *
 * Pricing precedence mirrors the entity's own price list, falling back to the
 * product catalog default for anything they haven't priced:
 *   - customer     → their customer_price_overrides  →  catalog
 *   - sales person → their affiliate_price_overrides  →  catalog
 * (The globally-active price list is intentionally NOT consulted here — a price
 * sheet shows the prices that entity has been given, falling back to catalog.)
 *
 * The single-vial price follows its own, separate precedence — the same one the
 * invoice form and `affiliateUnitPrice` quote from, so the sheet promises what
 * the invoice will actually charge: the entity's per-vial override
 * (`customer_price_overrides.vial_override_price`) when they have one,
 * otherwise the CATALOG vial price. A discounted box price never implies a
 * discounted vial — the two are priced independently.
 *
 * Amounts are never double-converted: a customer whose prices are stored in USD
 * (their overrides came from a USD price list) has those numbers shown 1:1, and
 * only the *catalog fallback* for a product they have no override on is
 * converted CAD→USD at the site exchange rate. The sheet's currency is resolved
 * from the entity's applied price list (authoritative for the stored numbers)
 * and falls back to their price_currency tag.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reportShell,
  table,
  money,
  escapeHtml,
  formatStockDisplay,
  readableDateTime,
  type Column,
} from '@/lib/admin/report-html';
import {
  productUsdPrice,
  usdFromCad,
  vialPriceFor,
  DEFAULT_USD_RATE,
  type PriceCurrency,
} from '@/lib/pricing';

export type PriceSheetKind = 'customer' | 'salesperson';

/** Resolved pricing identity + the numbers that drive one entity's price sheet. */
interface EntityPricing {
  /** Display name for the sheet title. */
  name: string;
  /** Currency the sheet's prices are expressed in. */
  currency: PriceCurrency;
  /** product_id → the entity's own box price override (native currency). */
  priceMap: Map<string, number>;
  /** product_id → the entity's own single-vial override (native currency). */
  vialMap: Map<string, number>;
  /** product_ids the entity has been hidden (excluded from the sheet). */
  hiddenSet: Set<string>;
}

/** Normalise a full name from parts, falling back to an email or a placeholder. */
function displayName(
  first?: string | null,
  last?: string | null,
  email?: string | null,
): string {
  return [first, last].filter(Boolean).join(' ') || email || 'Unnamed';
}

/** Currency of a customer row: their applied price list wins, else their tag. */
function customerCurrency(row: {
  price_currency?: string | null;
  applied_pricelist?: { currency?: string | null } | null;
}): PriceCurrency {
  const listCur = row.applied_pricelist?.currency;
  if (listCur === 'USD') return 'USD';
  if (listCur === 'CAD') return 'CAD';
  return row.price_currency === 'USD' ? 'USD' : 'CAD';
}

/** True when a box override should count — non-null and not the $0 "hidden" marker. */
function isRealPrice(v: unknown): boolean {
  return v != null && Number(v) !== 0;
}

/**
 * A customer's own price list: customer_price_overrides, which also carries
 * per-customer visibility (is_visible). A $0 box price is the "hidden" marker
 * (matches the invoice-form affiliate load) and is treated as no override.
 */
async function loadCustomerOverrides(
  supabase: SupabaseClient,
  customerId: string,
): Promise<{ priceMap: Map<string, number>; vialMap: Map<string, number>; hiddenSet: Set<string> }> {
  const priceMap = new Map<string, number>();
  const vialMap = new Map<string, number>();
  const hiddenSet = new Set<string>();

  const { data: overrides } = await supabase
    .from('customer_price_overrides')
    .select('product_id, override_price, vial_override_price, is_visible')
    .eq('customer_id', customerId);

  for (const o of (overrides as any[]) ?? []) {
    const pid = String(o.product_id);
    if (o.is_visible === false) hiddenSet.add(pid);
    if (isRealPrice(o.override_price)) priceMap.set(pid, Number(o.override_price));
    // A per-vial override of 0 is the same "no price" marker as a $0 box price.
    if (isRealPrice(o.vial_override_price)) vialMap.set(pid, Number(o.vial_override_price));
  }
  return { priceMap, vialMap, hiddenSet };
}

/**
 * A sales person / affiliate's own price list: affiliate_price_overrides, keyed
 * by their login id (sales_persons.user_id === affiliates.id). This table has no
 * visibility flag, so nothing is hidden — every product they haven't priced
 * falls back to catalog.
 *
 * `affiliate_price_overrides` stores a BOX price only, so their per-vial prices
 * are read from `customer_price_overrides` on the same login id — the row the
 * invoice's own vial path (`loadAffiliatePricingContext`) quotes from.
 */
async function loadAffiliateOverrides(
  supabase: SupabaseClient,
  affiliateId: string,
): Promise<{ priceMap: Map<string, number>; vialMap: Map<string, number>; hiddenSet: Set<string> }> {
  const priceMap = new Map<string, number>();
  const vialMap = new Map<string, number>();

  const [boxRes, vialRes] = await Promise.all([
    supabase
      .from('affiliate_price_overrides')
      .select('product_id, override_price')
      .eq('affiliate_id', affiliateId),
    supabase
      .from('customer_price_overrides')
      .select('product_id, vial_override_price')
      .eq('customer_id', affiliateId),
  ]);

  for (const o of (boxRes.data as any[]) ?? []) {
    if (isRealPrice(o.override_price)) priceMap.set(String(o.product_id), Number(o.override_price));
  }
  for (const o of (vialRes.data as any[]) ?? []) {
    if (isRealPrice(o.vial_override_price)) {
      vialMap.set(String(o.product_id), Number(o.vial_override_price));
    }
  }
  return { priceMap, vialMap, hiddenSet: new Set<string>() };
}

/** Resolve a customer's name, currency, and override numbers. */
async function resolveCustomer(
  supabase: SupabaseClient,
  id: string,
): Promise<EntityPricing | null> {
  const { data: cust } = await supabase
    .from('customers')
    .select(
      'first_name, last_name, email, price_currency, applied_pricelist:pricelists!customers_applied_pricelist_id_fkey(currency)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!cust) return null;

  const { priceMap, vialMap, hiddenSet } = await loadCustomerOverrides(supabase, id);
  return {
    name: displayName((cust as any).first_name, (cust as any).last_name, (cust as any).email),
    currency: customerCurrency(cust as any),
    priceMap,
    vialMap,
    hiddenSet,
  };
}

/**
 * Resolve a sales person's name, currency, and override numbers. A sales person
 * prices from their own affiliate/client price list (affiliate_price_overrides),
 * keyed by their linked login (sales_persons.user_id). A plain rep with no login
 * has no personal list, so the sheet falls back to catalog prices in CAD.
 */
async function resolveSalesPerson(
  supabase: SupabaseClient,
  id: string,
): Promise<EntityPricing | null> {
  const { data: sp } = await supabase
    .from('sales_persons')
    .select('first_name, last_name, email, user_id')
    .eq('id', id)
    .maybeSingle();
  if (!sp) return null;

  const pricingId: string | null = (sp as any).user_id ?? null;
  let currency: PriceCurrency = 'CAD';
  let priceMap = new Map<string, number>();
  let vialMap = new Map<string, number>();
  let hiddenSet = new Set<string>();
  if (pricingId) {
    const { data: linked } = await supabase
      .from('customers')
      .select(
        'price_currency, applied_pricelist:pricelists!customers_applied_pricelist_id_fkey(currency)',
      )
      .eq('id', pricingId)
      .maybeSingle();
    if (linked) currency = customerCurrency(linked as any);
    ({ priceMap, vialMap, hiddenSet } = await loadAffiliateOverrides(supabase, pricingId));
  }

  return {
    name: displayName((sp as any).first_name, (sp as any).last_name, (sp as any).email),
    currency,
    priceMap,
    vialMap,
    hiddenSet,
  };
}

/** One priced product line on the sheet. */
export interface PriceSheetRow {
  sku: string;
  description: string;
  /** Effective case (box) price in the sheet's currency. */
  price: number;
  /** Effective single-vial price in the sheet's currency. */
  vialPrice: number;
  /** Human-readable on-hand stock (only populated when inventory is included). */
  inventory: string | null;
}

/**
 * The resolved, render-agnostic content of one entity's price sheet — shared by
 * the print-ready HTML view and the attachable PDF so both show identical data.
 */
export interface PriceSheetData {
  kind: PriceSheetKind;
  /** "Customer" | "Sales rep". */
  kindLabel: string;
  /** Display name of the entity the sheet belongs to. */
  name: string;
  currency: PriceCurrency;
  includeInventory: boolean;
  rows: PriceSheetRow[];
  /** Short descriptive lines for the document header / meta strip. */
  meta: string[];
}

/**
 * Resolve the data behind one entity's price sheet. Returns null when the entity
 * doesn't exist. `includeInventory` adds the exact on-hand stock per product.
 */
export async function buildPriceSheetData(
  supabase: SupabaseClient,
  opts: { kind: PriceSheetKind; id: string; includeInventory: boolean },
): Promise<PriceSheetData | null> {
  const entity =
    opts.kind === 'customer'
      ? await resolveCustomer(supabase, opts.id)
      : await resolveSalesPerson(supabase, opts.id);
  if (!entity) return null;

  const [{ data: products }, { data: settings }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, slug, sku, price, price_usd, vial_price, stock_quantity, vials_per_box, active')
      .order('name', { ascending: true }),
    // usd_exchange_rate may not exist pre-migration; the failed select just
    // yields null and we fall back to the default rate.
    supabase.from('site_settings').select('usd_exchange_rate').maybeSingle(),
  ]);

  const rawRate = (settings as any)?.usd_exchange_rate;
  const usdRate = rawRate != null && Number(rawRate) > 0 ? Number(rawRate) : DEFAULT_USD_RATE;

  // Effective box price in the sheet's currency: the entity's own override
  // (stored native to their currency), else the catalog price — converted to
  // USD only when the catalog fallback is used on a USD sheet.
  const priceOf = (p: any): number => {
    const override = entity.priceMap.get(String(p.id));
    if (override != null) return override;
    return entity.currency === 'USD' ? productUsdPrice(p, usdRate) : Number(p.price) || 0;
  };

  // Effective single-vial price, on its own precedence: the entity's per-vial
  // override (already native to their currency), else the CATALOG vial price
  // (products.vial_price, or the catalog case price ÷ vials-per-case) —
  // converted CAD→USD only for that catalog fallback, exactly like the box.
  // A cheaper box price never drags the vial price down with it; that is how
  // the invoice prices a vial line too.
  const vialPriceOf = (p: any): number => {
    const override = entity.vialMap.get(String(p.id));
    if (override != null) return override;
    const cad = vialPriceFor({
      price: Number(p.price) || 0,
      vial_price: p.vial_price,
      vials_per_box: p.vials_per_box,
    });
    return entity.currency === 'USD' ? usdFromCad(cad, usdRate) : cad;
  };

  // A price sheet lists sellable products the entity can see: active, and not
  // hidden for them.
  const products_ = ((products as any[]) ?? []).filter(
    (p) => p.active !== false && !entity.hiddenSet.has(String(p.id)),
  );

  const rows: PriceSheetRow[] = products_.map((p: any) => ({
    sku: p.slug || p.sku || '—',
    description: p.name ?? '—',
    price: priceOf(p),
    vialPrice: vialPriceOf(p),
    inventory: opts.includeInventory
      ? formatStockDisplay(Number(p.stock_quantity) || 0, Number(p.vials_per_box) || 0, 'boxes')
      : null,
  }));

  const meta = [
    `Generated ${readableDateTime()}`,
    `${rows.length} product${rows.length === 1 ? '' : 's'}`,
    `Prices in ${entity.currency}`,
    'Case & single-vial prices',
  ];
  if (opts.includeInventory) meta.push('Inventory in boxes');

  return {
    kind: opts.kind,
    kindLabel: opts.kind === 'customer' ? 'Customer' : 'Sales rep',
    name: entity.name,
    currency: entity.currency,
    includeInventory: opts.includeInventory,
    rows,
    meta,
  };
}

/** Render one entity's price-sheet data as the print-ready, branded HTML view. */
export function renderPriceSheetHtml(data: PriceSheetData): string {
  const columns: Column[] = [
    { header: 'SKU' },
    { header: 'Description' },
    { header: `Case price (${data.currency})`, num: true },
    { header: `Vial price (${data.currency})`, num: true },
  ];
  if (data.includeInventory) columns.push({ header: 'Inventory' });

  const tableRows = data.rows.map((r) => {
    const cells = [
      `<span class="mono">${escapeHtml(r.sku)}</span>`,
      escapeHtml(r.description),
      money(r.price),
      money(r.vialPrice),
    ];
    if (data.includeInventory) cells.push(escapeHtml(r.inventory ?? '—'));
    return cells;
  });

  const body = `
    <h2>Price list</h2>
    ${table(columns, tableRows, 'No products to price.')}
  `;

  return reportShell({
    title: `Price List — ${data.name}`,
    branded: true,
    meta: data.meta,
    filters: [`${data.kindLabel}: ${data.name}`, `Currency: ${data.currency}`],
    body,
    footRight: `${data.rows.length} product${data.rows.length === 1 ? '' : 's'}`,
    autoPrint: true,
  });
}

/**
 * Build the print-ready HTML price sheet for one entity. Returns null when the
 * entity doesn't exist. `includeInventory` adds the exact on-hand Inventory
 * column.
 */
export async function buildPriceSheet(
  supabase: SupabaseClient,
  opts: { kind: PriceSheetKind; id: string; includeInventory: boolean },
): Promise<string | null> {
  const data = await buildPriceSheetData(supabase, opts);
  if (data === null) return null;
  return renderPriceSheetHtml(data);
}
