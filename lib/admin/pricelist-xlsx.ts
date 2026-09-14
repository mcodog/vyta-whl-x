/**
 * Excel (.xlsx) rendering for a downloadable price list.
 *
 * The working view of a list, next to the shareable PDF: by default it carries
 * the catalog price, the change against it, and whether each row is priced by
 * the list or falling back to the catalog. The Customize menu decides which
 * columns actually appear.
 *
 * Sheet 1 ("Price List") is deliberately machine-shaped — snake_case headers,
 * one header row, numeric prices — so a downloaded list can be edited in Excel
 * and fed straight back through the price-list import, which matches rows on
 * `product_id` / `sku` / `name` and reads the price from `price`. The human
 * context (name, currency, status, generated at) sits on a second "Details"
 * sheet that would otherwise break that shape, and can be turned off with the
 * rest of the document details.
 */

import * as XLSX from 'xlsx';
import {
  columnValue,
  defaultExportOptions,
  pricelistColumn,
  type PricelistExportOptions,
} from '@/lib/admin/pricelist-columns';
import type { PricelistExportData } from '@/lib/admin/pricelist-export';

/** Column width per column key, in characters. */
const WIDTHS: Record<string, number> = {
  product_id: 38,
  sku: 18,
  name: 34,
  strength: 12,
  price: 12,
  unlabeled_price: 16,
  catalog_price_cad: 18,
  change_vs_catalog_pct: 22,
  inventory: 20,
  source: 16,
};

/** The "Details" sheet: everything that isn't a priced row. */
function detailsSheet(data: PricelistExportData): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Field', 'Value'],
    ['Price list', data.name],
    ['Description', data.description ?? ''],
    ['Currency', data.currency],
    ['Status', data.isActive ? 'Active price list' : 'Not the active price list'],
    ['Products', data.rows.length],
    [
      'Priced by this list',
      data.isDefault ? 'n/a (catalog prices)' : data.rows.filter((r) => r.onList).length,
    ],
    ['Generated', data.generatedAt],
    [
      'Note',
      data.currency === 'CAD'
        ? 'catalog_price_cad is the Products price; change_vs_catalog_pct compares the list price against it.'
        : 'Prices are stored natively in USD; the CAD catalog price is shown for reference only and is not compared.',
    ],
  ]);
  sheet['!cols'] = [{ wch: 22 }, { wch: 80 }];
  return sheet;
}

/** Render the price list as an .xlsx workbook buffer. */
export function renderPricelistXlsx(
  data: PricelistExportData,
  options: PricelistExportOptions = defaultExportOptions('xlsx', data),
): Buffer {
  const specs = options.columns.map(pricelistColumn);
  const head = specs.map((c) => c.sheetKey);
  const rows = data.rows.map((r) => specs.map((c) => columnValue(c.key, r)));

  const sheet = XLSX.utils.aoa_to_sheet([head, ...rows]);
  sheet['!cols'] = head.map((h) => ({ wch: WIDTHS[h] ?? 14 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Price List');
  if (options.showMeta) XLSX.utils.book_append_sheet(wb, detailsSheet(data), 'Details');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
