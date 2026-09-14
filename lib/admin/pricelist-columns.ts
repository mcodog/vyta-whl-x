/**
 * What a downloaded price list contains — the columns and document toggles the
 * Customize menu drives, shared by the client menu, the export route and both
 * writers so all three agree on the vocabulary.
 *
 * Kept free of server-only imports (it is pulled into the admin bundle) and of
 * value imports from `pricelist-export`, which imports these defaults back.
 */

import type { PriceCurrency } from '@/lib/pricing';
import type { PricelistExportRow } from '@/lib/admin/pricelist-export';

export type PricelistExportFormat = 'pdf' | 'xlsx';

/** Every column a downloaded price list can carry, in report order. */
export type PricelistColumnKey =
  | 'productId'
  | 'sku'
  | 'product'
  | 'strength'
  | 'price'
  | 'unlabeled'
  | 'catalog'
  | 'change'
  | 'inventory'
  | 'source';

export interface PricelistColumnSpec {
  key: PricelistColumnKey;
  /** Plain name for the Customize menu, with no currency in it. */
  name: string;
  /** Header text. Price columns name the currency they are in. */
  label: (currency: PriceCurrency) => string;
  /** Header used by the Excel sheet — snake_case, and what the import reads. */
  sheetKey: string;
  /** One line of menu copy explaining the column. */
  desc: string;
  /** Right-aligned in the PDF, written as a number in Excel. */
  numeric: boolean;
  /** Relative width when the PDF lays its table out. */
  weight: number;
}

/** The columns, in the order a downloaded list renders them. */
export const PRICELIST_COLUMNS: PricelistColumnSpec[] = [
  {
    key: 'productId',
    name: 'Product ID',
    label: () => 'Product ID',
    sheetKey: 'product_id',
    desc: 'Internal id — what the price-list import matches on',
    numeric: false,
    weight: 2.4,
  },
  {
    key: 'sku',
    name: 'SKU',
    label: () => 'SKU',
    sheetKey: 'sku',
    desc: 'Product SKU, falling back to its slug',
    numeric: false,
    weight: 1.1,
  },
  {
    key: 'product',
    name: 'Description',
    label: () => 'Description',
    sheetKey: 'name',
    desc: 'Product name',
    numeric: false,
    weight: 2.8,
  },
  {
    key: 'strength',
    name: 'Strength',
    label: () => 'Strength',
    sheetKey: 'strength',
    desc: 'Dosage / strength',
    numeric: false,
    weight: 1.05,
  },
  {
    key: 'price',
    name: 'Price',
    label: (c) => `Price (${c})`,
    sheetKey: 'price',
    desc: "The list's price for the product",
    numeric: true,
    weight: 1.1,
  },
  {
    key: 'unlabeled',
    name: 'Unlabeled price',
    label: (c) => `Unlabeled (${c})`,
    sheetKey: 'unlabeled_price',
    desc: 'Unlabeled-vial price, on lists that price them separately',
    numeric: true,
    weight: 1.2,
  },
  {
    key: 'catalog',
    name: 'Catalog price (CAD)',
    label: () => 'Catalog (CAD)',
    sheetKey: 'catalog_price_cad',
    desc: 'The Products price the list is built on',
    numeric: true,
    weight: 1.2,
  },
  {
    key: 'change',
    name: 'Change vs catalog',
    label: () => 'Change',
    sheetKey: 'change_vs_catalog_pct',
    desc: 'How far the list price sits from the catalog price',
    numeric: true,
    weight: 1.1,
  },
  {
    key: 'inventory',
    name: 'Inventory',
    label: () => 'Inventory',
    sheetKey: 'inventory',
    desc: 'On-hand stock, in boxes',
    numeric: false,
    weight: 1.2,
  },
  {
    key: 'source',
    name: 'Source',
    label: () => 'Source',
    sheetKey: 'source',
    desc: 'Whether the row is priced by the list or falls back to the catalog',
    numeric: false,
    weight: 1.1,
  },
];

const BY_KEY = new Map(PRICELIST_COLUMNS.map((c) => [c.key, c]));

export const isPricelistColumn = (v: string): v is PricelistColumnKey => BY_KEY.has(v as PricelistColumnKey);

export const pricelistColumn = (key: PricelistColumnKey): PricelistColumnSpec => BY_KEY.get(key)!;

/** The shareable PDF: what a customer needs and nothing else. */
export const DEFAULT_PDF_COLUMNS: PricelistColumnKey[] = ['sku', 'product', 'price'];

/** The working sheet: the full picture, and re-importable. */
export const DEFAULT_XLSX_COLUMNS: PricelistColumnKey[] = [
  'productId',
  'sku',
  'product',
  'strength',
  'price',
  'catalog',
  'change',
  'source',
];

/** Everything the Customize menu can add, in report order. */
export const ALL_PRICELIST_COLUMNS: PricelistColumnKey[] = PRICELIST_COLUMNS.map((c) => c.key);

/** What a downloaded price list contains. */
export interface PricelistExportOptions {
  /**
   * Columns to render, in the order they appear in the file. Selections coming
   * off the wire are normalised to report order by `resolveColumns`, and never
   * arrive empty.
   */
  columns: PricelistColumnKey[];
  /** Print the price list's name under the document title. */
  showName: boolean;
  /** Print the list's description. */
  showDescription: boolean;
  /** Print the details strip (generated, product count, currency, status). */
  showMeta: boolean;
  /** Drop the rows that fall back to the catalog price. */
  onlyPriced: boolean;
}

/** Sort an arbitrary column selection into report order, dropping duplicates. */
export function orderColumns(keys: Iterable<PricelistColumnKey>): PricelistColumnKey[] {
  const wanted = new Set(keys);
  return ALL_PRICELIST_COLUMNS.filter((k) => wanted.has(k));
}

/**
 * The columns a format starts with. A list that prices unlabeled vials gets
 * that column by default — it is the whole point of such a list.
 */
export function defaultColumns(
  format: PricelistExportFormat,
  list: { hasUnlabeled?: boolean } = {},
): PricelistColumnKey[] {
  const base = format === 'xlsx' ? DEFAULT_XLSX_COLUMNS : DEFAULT_PDF_COLUMNS;
  return list.hasUnlabeled ? orderColumns([...base, 'unlabeled']) : [...base];
}

/** The default document toggles: name, description and details all printed. */
export function defaultExportOptions(
  format: PricelistExportFormat,
  list: { hasUnlabeled?: boolean } = {},
): PricelistExportOptions {
  return {
    columns: defaultColumns(format, list),
    showName: true,
    showDescription: true,
    showMeta: true,
    onlyPriced: false,
  };
}

/**
 * Resolve a requested column selection. Unknown keys are dropped and an empty
 * selection falls back to the format's defaults, so a download can never come
 * out with no columns at all.
 */
export function resolveColumns(
  requested: readonly string[] | null | undefined,
  format: PricelistExportFormat,
  list: { hasUnlabeled?: boolean } = {},
): PricelistColumnKey[] {
  const valid = (requested ?? []).map((c) => c.trim()).filter(isPricelistColumn);
  return valid.length > 0 ? orderColumns(valid) : defaultColumns(format, list);
}

/** Read a `1` / `0` style flag, falling back when the caller didn't send one. */
export function readFlag(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/** The raw cell value for one column — numbers stay numbers for Excel. */
export function columnValue(
  key: PricelistColumnKey,
  row: PricelistExportRow,
): string | number | null {
  switch (key) {
    case 'productId':
      return row.productId;
    case 'sku':
      return row.sku;
    case 'product':
      return row.name;
    case 'strength':
      return row.strength;
    case 'price':
      return row.price;
    case 'unlabeled':
      return row.unlabeledPrice;
    case 'catalog':
      return row.catalogPrice;
    case 'change':
      return row.changePct;
    case 'inventory':
      return row.inventory;
    case 'source':
      return row.onList ? 'list' : 'catalog default';
  }
}

const money = (n: number) => `$${Number(n ?? 0).toFixed(2)}`;

/** The printed cell text for one column, as the PDF shows it. */
export function columnText(key: PricelistColumnKey, row: PricelistExportRow): string {
  switch (key) {
    case 'price':
      return money(row.price);
    case 'unlabeled':
      return row.unlabeledPrice == null ? '—' : money(row.unlabeledPrice);
    case 'catalog':
      return money(row.catalogPrice);
    case 'change':
      if (row.changePct == null) return '—';
      return row.changePct === 0 ? '—' : `${row.changePct > 0 ? '+' : ''}${row.changePct.toFixed(1)}%`;
    case 'source':
      return row.onList ? 'List' : 'Catalog';
    default: {
      const v = columnValue(key, row);
      return v == null || v === '' ? '—' : String(v);
    }
  }
}
