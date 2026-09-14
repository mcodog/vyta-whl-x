import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { buildPricelistExportData } from '@/lib/admin/pricelist-export';
import { renderPricelistPdf } from '@/lib/admin/pricelist-pdf';
import { renderPriceSheetPdf } from '@/lib/admin/price-sheet-pdf';
import { renderPackingListPdf } from '@/lib/admin/packing-list-pdf';
import { renderStockReportPdf } from '@/lib/admin/stock-report-pdf';
import { renderInvoicePdf } from '@/lib/invoice-pdf';

/**
 * Count the text-showing operators on each page. These documents use only the
 * standard 14 fonts, so nothing is embedded and every stream in the file is a
 * page's content — a page whose stream shows no text is a blank page.
 */
function textOpsPerPage(buf: Buffer): number[] {
  const ops: number[] = [];
  let i = 0;
  for (;;) {
    const start = buf.indexOf('stream', i);
    if (start === -1) break;
    if (buf.subarray(Math.max(0, start - 3), start).toString() === 'end') {
      i = start + 6;
      continue;
    }
    let body = start + 6;
    if (buf[body] === 0x0d) body++;
    if (buf[body] === 0x0a) body++;
    const end = buf.indexOf('endstream', body);
    if (end === -1) break;
    let text = '';
    try {
      text = zlib.inflateSync(buf.subarray(body, end)).toString('latin1');
    } catch {
      /* not a flate stream — leave it as no text */
    }
    ops.push((text.match(/T[jJ]/g) || []).length);
    i = end + 9;
  }
  return ops;
}

/** A page carrying a footer and nothing else is what the bug produced. */
const BLANK_PAGE_OPS = 2;

const products = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Peptide ${i}`,
    slug: `peptide-${i}`,
    sku: `SKU-${i}`,
    strength: '10mg',
    price: 100 + i,
  }));

const pricelist = (n: number) =>
  buildPricelistExportData(
    { id: 'l1', name: 'Wholesale 2026', currency: 'CAD', is_active: true },
    products(n).map((p, i) => ({ product_id: p.id, price: 90 + i })),
    products(n),
  );

const stockTotals = {
  products: 0, active: 0, units: 0, onOrder: 0,
  needToOrder: 0, needCount: 0, outOfStock: 0, lowStock: 0,
};

// Every branded document draws its footer below the bottom margin. pdfkit
// treats that strip as overflow, so before drawInFooterStrip each finished page
// grew a blank twin: a 3-row price list came out as 2 pages, a 60-row one as 6.
describe('footer strip does not spill onto a blank page', () => {
  it('keeps a short price list to a single page', async () => {
    const ops = textOpsPerPage(await renderPricelistPdf(pricelist(3)));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toBeGreaterThan(BLANK_PAGE_OPS);
  });

  it('leaves no blank page in a multi-page price list', async () => {
    const ops = textOpsPerPage(await renderPricelistPdf(pricelist(60)));
    expect(ops.length).toBeGreaterThan(1);
    expect(ops.every((n) => n > BLANK_PAGE_OPS)).toBe(true);
  });

  it('leaves no blank page in a price sheet', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      sku: `SKU-${i}`, description: `Peptide ${i}`, price: 100 + i, vialPrice: 10 + i, inventory: null,
    }));
    const buf = await renderPriceSheetPdf({
      kind: 'customer', kindLabel: 'Customer', name: 'Acme Labs', currency: 'CAD',
      includeInventory: false, rows, meta: ['Generated now', '60 products'],
    } as any);
    expect(textOpsPerPage(buf).every((n) => n > BLANK_PAGE_OPS)).toBe(true);
  });

  it('leaves no blank page in a packing list', async () => {
    const buf = await renderPackingListPdf({
      invoice_number: 'INV-1', recipient_name: 'Acme', ship_to: { city: 'Toronto' },
      line_items: Array.from({ length: 40 }, (_, i) => ({ sku: `S${i}`, description: `Item ${i}`, qty: 2 })),
    } as any);
    expect(textOpsPerPage(buf).every((n) => n > BLANK_PAGE_OPS)).toBe(true);
  });

  it('leaves no blank page in a stock report', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`, name: `Peptide ${i}`, slug: `peptide-${i}`, sku: `SKU-${i}`, strength: '10mg',
      category: 'GLP-1', active: true, stock: 10, vialsPerBox: 10, minQty: 5, onOrder: 0, needToOrder: 0,
    }));
    const buf = await renderStockReportPdf({
      rows, totals: { ...stockTotals, products: 40, active: 40 }, contributingPos: [], filters: [],
    } as any);
    expect(textOpsPerPage(buf).every((n) => n > BLANK_PAGE_OPS)).toBe(true);
  });

  it('does not end an invoice on a blank page', async () => {
    // Long invoices still spill blank pages *mid-document* — the line-item
    // table has no page-break handling of its own — so only the trailing page
    // the footer used to create is asserted here.
    const buf = await renderInvoicePdf({
      invoice_number: 'INV-1000', status: 'sent', due_date: '2026-09-30', issue_date: '2026-08-31',
      customer_name: 'Acme Labs', customer_email: 'acme@example.com',
      line_items: Array.from({ length: 4 }, (_, i) => ({
        description: `Peptide ${i}`, sku: `SKU-${i}`, qty: 2, unit_price: 100 + i, total: (100 + i) * 2,
      })),
      subtotal: 800, total: 800,
    } as any);
    const ops = textOpsPerPage(buf);
    expect(ops[ops.length - 1]).toBeGreaterThan(BLANK_PAGE_OPS);
  });
});
