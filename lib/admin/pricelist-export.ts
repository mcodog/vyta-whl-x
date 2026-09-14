/**
 * Downloadable price lists (Admin → Pricing → Price Lists).
 *
 * Resolves one named price list — or the pinned "Default Prices" record, which
 * is the product catalog's own prices — into a render-agnostic table that the
 * PDF and Excel writers both render, so a downloaded price list matches what
 * the Pricing screen shows.
 *
 * Row set mirrors the price-list editor: every active product appears, priced
 * from the list when it carries that product and falling back to the catalog
 * price when it doesn't (the same fallback invoicing uses). `onList` records
 * which of the two a row came from.
 *
 * Currency: a list stores its prices natively in its own currency
 * (`pricelists.currency`), so the numbers are never converted here. The catalog
 * comparison column is CAD, which is why `changePct` is only computed for a CAD
 * list — comparing a USD list price against a CAD catalog price would be a
 * meaningless percentage.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatStockDisplay, readableDateTime } from '@/lib/admin/report-html';
import { round2, toPriceCurrency, type PriceCurrency } from '@/lib/pricing';
import type { PricelistExportOptions } from '@/lib/admin/pricelist-columns';

/**
 * Id used for the catalog's own prices. The Price Lists view pins these as a
 * read-only "Default Prices" record, so they are downloadable like any list.
 */
export const DEFAULT_PRICELIST_ID = 'default';

export const DEFAULT_PRICELIST_NAME = 'Default Prices';

/** An active product as the export reads it. */
export interface ExportProduct {
  id: string;
  name: string | null;
  slug?: string | null;
  sku?: string | null;
  strength?: string | null;
  price?: number | null;
  /** On-hand vials, for the optional Inventory column. */
  stock_quantity?: number | null;
  vials_per_box?: number | null;
}

/** One `pricelist_items` row (the list's price for a product). */
export interface ExportItem {
  product_id: string;
  price?: number | null;
  /** Set only on lists that price labeled and unlabeled vials separately. */
  unlabeled_price?: number | null;
}

/** The `pricelists` header row the export needs. */
export interface ExportList {
  id: string;
  name: string;
  description?: string | null;
  currency?: string | null;
  is_active?: boolean | null;
}

/** One priced product line of the downloaded price list. */
export interface PricelistExportRow {
  productId: string;
  sku: string;
  name: string;
  strength: string;
  /** Effective price in the list's currency. */
  price: number;
  /** The list's unlabeled-vial price, when it prices those separately. */
  unlabeledPrice: number | null;
  /** The catalog (Products) price, always CAD. */
  catalogPrice: number;
  /** % above/below the catalog price; null when the two aren't comparable. */
  changePct: number | null;
  /** Human-readable on-hand stock, e.g. "24 boxes (3 vials)". */
  inventory: string;
  /** False when the list doesn't price this product and the catalog fills in. */
  onList: boolean;
}

/** The resolved content of one downloadable price list. */
export interface PricelistExportData {
  id: string;
  name: string;
  description: string | null;
  currency: PriceCurrency;
  /** True when this list (or, for the catalog record, no list) is in effect. */
  isActive: boolean;
  /** True for the catalog's own prices rather than a named list. */
  isDefault: boolean;
  /** True when at least one row carries an unlabeled price. */
  hasUnlabeled: boolean;
  rows: PricelistExportRow[];
  /** Short descriptive lines for the document header / meta strip. */
  meta: string[];
  generatedAt: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A price counts when it is present and non-negative. */
const isPricedValue = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;

/**
 * Build the render-agnostic price-list table from already-loaded rows. Pure, so
 * both writers and the tests share exactly one definition of the numbers.
 */
export function buildPricelistExportData(
  list: ExportList,
  items: ExportItem[],
  products: ExportProduct[],
  opts: { isDefault?: boolean; now?: Date } = {},
): PricelistExportData {
  const isDefault = opts.isDefault ?? list.id === DEFAULT_PRICELIST_ID;
  const currency = toPriceCurrency(list.currency);
  const generatedAt = readableDateTime(opts.now ?? new Date());

  const priced = new Map<string, ExportItem>();
  if (!isDefault) {
    for (const it of items ?? []) {
      if (it?.product_id != null) priced.set(String(it.product_id), it);
    }
  }

  const rows: PricelistExportRow[] = (products ?? []).map((p) => {
    const catalogPrice = round2(num(p.price));
    const item = priced.get(String(p.id));
    const onList = item != null && isPricedValue(item.price);
    const price = onList ? round2(num(item!.price)) : catalogPrice;
    const unlabeledPrice =
      item != null && isPricedValue(item.unlabeled_price) ? round2(num(item.unlabeled_price)) : null;
    // Only a CAD list is comparable against the (CAD) catalog price.
    const comparable = currency === 'CAD' && catalogPrice > 0;
    return {
      productId: String(p.id),
      sku: (p.sku || p.slug || '').trim() || '—',
      name: (p.name || '').trim() || '—',
      strength: (p.strength || '').trim(),
      price,
      unlabeledPrice,
      catalogPrice,
      changePct: comparable ? round2(((price - catalogPrice) / catalogPrice) * 100) : null,
      inventory: formatStockDisplay(
        Number(p.stock_quantity) || 0,
        Number(p.vials_per_box) || 0,
        'boxes',
      ),
      onList,
    };
  });

  const isActive = Boolean(list.is_active);

  const meta = metaLines({ generatedAt, rows, currency, isDefault, isActive });

  return {
    id: list.id,
    name: list.name,
    description: (list.description ?? null) || null,
    currency,
    isActive,
    isDefault,
    hasUnlabeled: rows.some((r) => r.unlabeledPrice != null),
    rows,
    meta,
    generatedAt,
  };
}

/** The document's meta strip, derived from the rows it actually carries. */
function metaLines(opts: {
  generatedAt: string;
  rows: PricelistExportRow[];
  currency: PriceCurrency;
  isDefault: boolean;
  isActive: boolean;
}): string[] {
  const { generatedAt, rows, currency, isDefault, isActive } = opts;
  const meta = [
    `Generated ${generatedAt}`,
    `${rows.length} product${rows.length === 1 ? '' : 's'}`,
    `Prices in ${currency}`,
  ];
  if (!isDefault) {
    meta.push(`${rows.filter((r) => r.onList).length} priced by this list`);
  }
  meta.push(isActive ? 'Active price list' : 'Not the active price list');
  return meta;
}

/**
 * Narrow a resolved price list to what the download asked for. Only the row set
 * is option-dependent — which columns those rows render as is the writers' job —
 * and dropping rows re-derives the meta strip so its counts still match.
 */
export function applyExportOptions(
  data: PricelistExportData,
  options: Pick<PricelistExportOptions, 'onlyPriced'>,
): PricelistExportData {
  // The catalog record prices nothing itself, so "only priced" would empty it.
  if (!options.onlyPriced || data.isDefault) return data;
  const rows = data.rows.filter((r) => r.onList);
  return {
    ...data,
    rows,
    meta: metaLines({
      generatedAt: data.generatedAt,
      rows,
      currency: data.currency,
      isDefault: data.isDefault,
      isActive: data.isActive,
    }),
  };
}

/** Active products, ordered by name — the row set of every downloaded list. */
async function loadActiveProducts(supabase: SupabaseClient): Promise<ExportProduct[]> {
  const { data } = await supabase
    .from('products')
    .select('id, name, slug, sku, strength, price, stock_quantity, vials_per_box')
    .eq('active', true)
    .order('name', { ascending: true });
  return ((data as ExportProduct[]) ?? []);
}

/**
 * A list's item prices. `unlabeled_price` only exists after the labeled /
 * unlabeled migration, so a failed select falls back to the base columns rather
 * than failing the whole download.
 */
async function loadItems(supabase: SupabaseClient, pricelistId: string): Promise<ExportItem[]> {
  const withUnlabeled = await supabase
    .from('pricelist_items')
    .select('product_id, price, unlabeled_price')
    .eq('pricelist_id', pricelistId);
  if (!withUnlabeled.error) return ((withUnlabeled.data as ExportItem[]) ?? []);

  const { data } = await supabase
    .from('pricelist_items')
    .select('product_id, price')
    .eq('pricelist_id', pricelistId);
  return ((data as ExportItem[]) ?? []);
}

/**
 * Resolve a downloadable price list by id. Pass {@link DEFAULT_PRICELIST_ID}
 * for the catalog's own prices. Returns null when the list doesn't exist.
 */
export async function loadPricelistExport(
  supabase: SupabaseClient,
  id: string,
): Promise<PricelistExportData | null> {
  const products = await loadActiveProducts(supabase);

  if (id === DEFAULT_PRICELIST_ID) {
    // The catalog prices are in effect exactly when no custom list is active.
    const { data: active } = await supabase
      .from('pricelists')
      .select('id')
      .eq('is_active', true)
      .maybeSingle();
    return buildPricelistExportData(
      {
        id: DEFAULT_PRICELIST_ID,
        name: DEFAULT_PRICELIST_NAME,
        description: 'Base catalog prices from Products',
        currency: 'CAD',
        is_active: !active,
      },
      [],
      products,
      { isDefault: true },
    );
  }

  const { data: list } = await supabase
    .from('pricelists')
    .select('id, name, description, currency, is_active')
    .eq('id', id)
    .maybeSingle();
  if (!list) return null;

  const items = await loadItems(supabase, id);
  return buildPricelistExportData(list as ExportList, items, products, { isDefault: false });
}

/** A safe, extension-less file name for a downloaded price list. */
export function pricelistFileBase(data: Pick<PricelistExportData, 'name'>): string {
  const slug = (data.name || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
  return `price-list-${slug || 'export'}`;
}
