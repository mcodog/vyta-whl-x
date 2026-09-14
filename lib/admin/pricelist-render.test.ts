import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { ALL_PRICELIST_COLUMNS } from './pricelist-columns';
import { buildPricelistExportData, type ExportProduct } from './pricelist-export';
import { defaultExportOptions, type PricelistExportOptions } from './pricelist-columns';
import { renderPricelistPdf } from './pricelist-pdf';
import { renderPricelistXlsx } from './pricelist-xlsx';

// Enough products to spill onto a second PDF page, with long names so rows wrap.
const products: ExportProduct[] = Array.from({ length: 60 }, (_, i) => ({
  id: `p${i}`,
  name: `Product ${i} — a deliberately long description that wraps inside the table`,
  slug: `product-${i}`,
  sku: `SKU-${i}`,
  strength: i % 2 ? '10mg' : null,
  price: 100 + i,
}));

// The first 30 products are priced by the list; the rest fall back to catalog.
const data = buildPricelistExportData(
  { id: 'l1', name: 'Wholesale 2026', description: 'Bulk buyers', currency: 'CAD', is_active: true },
  products.slice(0, 30).map((p, i) => ({
    product_id: p.id,
    price: 90 + i,
    unlabeled_price: i === 0 ? 80 : null,
  })),
  products,
);

/** Page size of the first page, from the PDF's MediaBox. */
function mediaBox(buf: Buffer): [number, number] {
  const m = buf.toString('latin1').match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  if (!m) throw new Error('no MediaBox');
  return [Math.round(Number(m[1])), Math.round(Number(m[2]))];
}

/** The default options with a few fields overridden. */
const options = (over: Partial<PricelistExportOptions> = {}): PricelistExportOptions => ({
  ...defaultExportOptions('xlsx', data),
  ...over,
});

describe('renderPricelistPdf', () => {
  it('renders a PDF document', async () => {
    const buf = await renderPricelistPdf(data);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(2000);
  });

  it('renders an empty list without throwing', async () => {
    const empty = buildPricelistExportData({ id: 'l2', name: 'Empty', currency: 'USD' }, [], []);
    const buf = await renderPricelistPdf(empty);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('turns landscape for a wide column selection', async () => {
    // A4 is 595 x 842 points; the wide table needs the long edge.
    expect(mediaBox(await renderPricelistPdf(data))).toEqual([595, 842]);
    expect(
      mediaBox(await renderPricelistPdf(data, options({ columns: [...ALL_PRICELIST_COLUMNS] }))),
    ).toEqual([842, 595]);
  });

  it('lays out any column selection, from one column to all of them', async () => {
    const single = await renderPricelistPdf(data, options({ columns: ['price'] }));
    expect(single.subarray(0, 5).toString()).toBe('%PDF-');

    const everything = await renderPricelistPdf(
      data,
      options({ columns: [...ALL_PRICELIST_COLUMNS] }),
    );
    expect(everything.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders with every document detail turned off', async () => {
    const bare = await renderPricelistPdf(
      data,
      options({ showName: false, showDescription: false, showMeta: false }),
    );
    expect(bare.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('renderPricelistXlsx', () => {
  it('writes the data sheet plus a details sheet', () => {
    const wb = XLSX.read(renderPricelistXlsx(data), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Price List', 'Details']);

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Price List']);
    expect(rows).toHaveLength(products.length);
    expect(rows[0].price).toBe(90);
    expect(rows[0].catalog_price_cad).toBe(100);
    expect(rows[0].source).toBe('list');
    expect(rows[59].source).toBe('catalog default');
  });

  it('keeps the columns the price-list import matches on', () => {
    const wb = XLSX.read(renderPricelistXlsx(data), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Price List']);
    for (const key of ['product_id', 'sku', 'name', 'price']) {
      expect(Object.keys(rows[0])).toContain(key);
    }
    expect(rows[0].product_id).toBe('p0');
    expect(rows[0].sku).toBe('SKU-0');
  });

  it('writes exactly the requested columns, in the order given', () => {
    const wb = XLSX.read(renderPricelistXlsx(data, options({ columns: ['product', 'sku'] })), {
      type: 'buffer',
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Price List']);
    expect(Object.keys(rows[0])).toEqual(['name', 'sku']);
  });

  it('drops the Details sheet when the document details are off', () => {
    const wb = XLSX.read(renderPricelistXlsx(data, options({ showMeta: false })), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Price List']);
  });

  it('only adds the unlabeled column when the list prices them', () => {
    const withUnlabeled = XLSX.read(renderPricelistXlsx(data), { type: 'buffer' });
    const unlabeledRows = XLSX.utils.sheet_to_json<Record<string, any>>(
      withUnlabeled.Sheets['Price List'],
      { defval: '' },
    );
    expect(Object.keys(unlabeledRows[0])).toContain('unlabeled_price');

    const plain = buildPricelistExportData(
      { id: 'l3', name: 'Plain', currency: 'CAD' },
      [{ product_id: 'p0', price: 90 }],
      products,
    );
    const plainRows = XLSX.utils.sheet_to_json<Record<string, any>>(
      XLSX.read(renderPricelistXlsx(plain), { type: 'buffer' }).Sheets['Price List'],
      { defval: '' },
    );
    expect(Object.keys(plainRows[0])).not.toContain('unlabeled_price');
  });
});
