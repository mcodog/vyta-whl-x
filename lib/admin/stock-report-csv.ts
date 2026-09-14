import type { StockReportData, StockReportRow } from '@/lib/admin/stock-report';

/**
 * Renders the Stock Report as CSV — one row per product, quantities only (no
 * money). Attached alongside the PDF so recipients can open the figures in a
 * spreadsheet.
 */

/** Quote a CSV field when it contains a comma, quote, or newline. */
function csvField(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function statusText(r: StockReportRow): string {
  if (r.stock <= 0) return 'Out of stock';
  if (r.minQty > 0 && r.stock <= r.minQty) return 'Low';
  return 'In stock';
}

export function renderStockReportCsv(data: StockReportData): string {
  const headers = [
    'Product',
    'Strength',
    'Category',
    'Stock',
    'Min Quantity',
    'On Order',
    'Need To Order',
    'Status',
    'Active',
  ];

  const lines = [headers.map(csvField).join(',')];
  for (const r of data.rows) {
    lines.push(
      [
        r.name,
        r.strength ?? '',
        r.category ?? '',
        r.stock,
        r.minQty,
        r.onOrder,
        r.needToOrder,
        statusText(r),
        r.active ? 'Yes' : 'No',
      ]
        .map(csvField)
        .join(','),
    );
  }

  // Leading BOM so Excel opens UTF-8 (accents, symbols) correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
