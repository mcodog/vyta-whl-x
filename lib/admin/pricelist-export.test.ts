import { describe, it, expect } from 'vitest';
import {
  applyExportOptions,
  buildPricelistExportData,
  pricelistFileBase,
  DEFAULT_PRICELIST_ID,
  type ExportProduct,
} from './pricelist-export';

const products: ExportProduct[] = [
  {
    id: 'p1', name: 'Semaglutide', slug: 'semaglutide', sku: 'SEMA-5', strength: '5mg',
    price: 100, stock_quantity: 243, vials_per_box: 10,
  },
  { id: 'p2', name: 'Tirzepatide', slug: 'tirzepatide', sku: null, strength: null, price: 200 },
  { id: 'p3', name: 'Retatrutide', slug: 'retatrutide', sku: 'RETA-10', strength: null, price: 0 },
];

const cadList = { id: 'l1', name: 'Wholesale 2026', description: 'Bulk buyers', currency: 'CAD', is_active: true };

describe('buildPricelistExportData', () => {
  it('prices rows from the list and falls back to the catalog', () => {
    const data = buildPricelistExportData(
      cadList,
      [{ product_id: 'p1', price: 90 }],
      products,
    );

    expect(data.rows).toHaveLength(3);
    expect(data.rows[0]).toMatchObject({ sku: 'SEMA-5', price: 90, catalogPrice: 100, onList: true });
    // Not priced by the list → the catalog price fills in, as invoicing does.
    expect(data.rows[1]).toMatchObject({ price: 200, catalogPrice: 200, onList: false });
  });

  it('computes the change against the catalog price for a CAD list', () => {
    const data = buildPricelistExportData(cadList, [{ product_id: 'p1', price: 90 }], products);
    expect(data.rows[0].changePct).toBe(-10);
    expect(data.rows[1].changePct).toBe(0);
    // A $0 catalog price has no meaningful percentage.
    expect(data.rows[2].changePct).toBeNull();
  });

  it('never compares a USD list against the CAD catalog price', () => {
    const data = buildPricelistExportData(
      { ...cadList, currency: 'USD' },
      [{ product_id: 'p1', price: 75 }],
      products,
    );
    expect(data.currency).toBe('USD');
    expect(data.rows[0].price).toBe(75);
    expect(data.rows.every((r) => r.changePct === null)).toBe(true);
  });

  it('treats a missing price as no override but keeps a $0 list price', () => {
    const data = buildPricelistExportData(
      cadList,
      [
        { product_id: 'p1', price: null },
        { product_id: 'p2', price: 0 },
      ],
      products,
    );
    expect(data.rows[0]).toMatchObject({ price: 100, onList: false });
    expect(data.rows[1]).toMatchObject({ price: 0, onList: true });
  });

  it('flags unlabeled pricing only when a row carries one', () => {
    const plain = buildPricelistExportData(cadList, [{ product_id: 'p1', price: 90 }], products);
    expect(plain.hasUnlabeled).toBe(false);
    expect(plain.rows[0].unlabeledPrice).toBeNull();

    const labeled = buildPricelistExportData(
      cadList,
      [{ product_id: 'p1', price: 90, unlabeled_price: 80 }],
      products,
    );
    expect(labeled.hasUnlabeled).toBe(true);
    expect(labeled.rows[0].unlabeledPrice).toBe(80);
  });

  it('prices the default record straight from the catalog, ignoring items', () => {
    const data = buildPricelistExportData(
      { id: DEFAULT_PRICELIST_ID, name: 'Default Prices', currency: 'CAD', is_active: true },
      [{ product_id: 'p1', price: 90 }],
      products,
      { isDefault: true },
    );
    expect(data.isDefault).toBe(true);
    expect(data.rows.every((r) => !r.onList)).toBe(true);
    expect(data.rows[0].price).toBe(100);
    // The "priced by this list" line is meaningless for the catalog record.
    expect(data.meta.some((m) => m.includes('priced by this list'))).toBe(false);
  });

  it('describes the list in its meta strip', () => {
    const data = buildPricelistExportData(cadList, [{ product_id: 'p1', price: 90 }], products, {
      now: new Date('2026-08-31T15:45:00Z'),
    });
    expect(data.meta).toContain('3 products');
    expect(data.meta).toContain('Prices in CAD');
    expect(data.meta).toContain('1 priced by this list');
    expect(data.meta).toContain('Active price list');

    const inactive = buildPricelistExportData({ ...cadList, is_active: false }, [], products);
    expect(inactive.meta).toContain('Not the active price list');
  });

  it('reads on-hand stock for the optional inventory column', () => {
    const data = buildPricelistExportData(cadList, [], products);
    expect(data.rows[0].inventory).toBe('24 boxes (3 vials)');
    // A product with no stock recorded still gets a printable cell.
    expect(data.rows[1].inventory).toBe('0 vials');
  });

  it('falls back to the slug when a product has no SKU', () => {
    const data = buildPricelistExportData(cadList, [], products);
    expect(data.rows[1].sku).toBe('tirzepatide');
  });
});

describe('applyExportOptions', () => {
  const data = buildPricelistExportData(
    cadList,
    [{ product_id: 'p1', price: 90 }],
    products,
  );

  it('leaves the rows alone by default', () => {
    expect(applyExportOptions(data, { onlyPriced: false })).toBe(data);
  });

  it('drops catalog-fallback rows and recounts the meta strip', () => {
    const only = applyExportOptions(data, { onlyPriced: true });
    expect(only.rows).toHaveLength(1);
    expect(only.rows[0].onList).toBe(true);
    expect(only.meta).toContain('1 product');
    expect(only.meta).toContain('1 priced by this list');
    // The source data is untouched.
    expect(data.rows).toHaveLength(3);
  });

  it('never empties the catalog record, which prices nothing itself', () => {
    const catalog = buildPricelistExportData(
      { id: DEFAULT_PRICELIST_ID, name: 'Default Prices', currency: 'CAD', is_active: true },
      [],
      products,
      { isDefault: true },
    );
    expect(applyExportOptions(catalog, { onlyPriced: true }).rows).toHaveLength(3);
  });
});

describe('pricelistFileBase', () => {
  it('slugifies the list name', () => {
    expect(pricelistFileBase({ name: 'Wholesale 2026' })).toBe('price-list-wholesale-2026');
    expect(pricelistFileBase({ name: 'Christian Harcus — USD' })).toBe('price-list-christian-harcus-usd');
  });

  it('falls back when the name slugifies to nothing', () => {
    expect(pricelistFileBase({ name: '—' })).toBe('price-list-export');
  });
});
