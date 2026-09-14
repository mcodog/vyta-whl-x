import { describe, it, expect } from 'vitest';
import {
  ALL_PRICELIST_COLUMNS,
  DEFAULT_PDF_COLUMNS,
  DEFAULT_XLSX_COLUMNS,
  columnText,
  columnValue,
  defaultColumns,
  defaultExportOptions,
  orderColumns,
  readFlag,
  resolveColumns,
  type PricelistColumnKey,
} from './pricelist-columns';
import type { PricelistExportRow } from './pricelist-export';

const row: PricelistExportRow = {
  productId: 'p1',
  sku: 'SEMA-5',
  name: 'Semaglutide',
  strength: '5mg',
  price: 90,
  unlabeledPrice: 80,
  catalogPrice: 100,
  changePct: -10,
  inventory: '24 boxes',
  onList: true,
};

describe('resolveColumns', () => {
  it('keeps only known keys, in report order', () => {
    expect(resolveColumns(['price', 'nonsense', 'sku'], 'pdf')).toEqual(['sku', 'price']);
  });

  it('falls back to the format defaults when nothing usable is asked for', () => {
    expect(resolveColumns([], 'pdf')).toEqual(DEFAULT_PDF_COLUMNS);
    expect(resolveColumns(['nope'], 'xlsx')).toEqual(DEFAULT_XLSX_COLUMNS);
    expect(resolveColumns(undefined, 'xlsx')).toEqual(DEFAULT_XLSX_COLUMNS);
  });

  it('adds the unlabeled column by default only on a list that prices them', () => {
    expect(defaultColumns('pdf')).not.toContain('unlabeled');
    expect(defaultColumns('pdf', { hasUnlabeled: true })).toContain('unlabeled');
    // Still in report order — right after price.
    expect(defaultColumns('pdf', { hasUnlabeled: true })).toEqual(['sku', 'product', 'price', 'unlabeled']);
  });

  it('does not let an explicit selection be overridden by the default', () => {
    expect(resolveColumns(['sku'], 'pdf', { hasUnlabeled: true })).toEqual(['sku']);
  });
});

describe('orderColumns', () => {
  it('sorts into report order and drops duplicates', () => {
    const messy: PricelistColumnKey[] = ['source', 'sku', 'sku', 'product'];
    expect(orderColumns(messy)).toEqual(['sku', 'product', 'source']);
  });

  it('is a no-op on the full ordered list', () => {
    expect(orderColumns(ALL_PRICELIST_COLUMNS)).toEqual(ALL_PRICELIST_COLUMNS);
  });
});

describe('defaultExportOptions', () => {
  it('prints every document detail out of the box', () => {
    const opts = defaultExportOptions('pdf');
    expect(opts).toMatchObject({ showName: true, showDescription: true, showMeta: true, onlyPriced: false });
  });
});

describe('readFlag', () => {
  it('reads 1/0 and true/false, falling back when absent', () => {
    expect(readFlag('1', false)).toBe(true);
    expect(readFlag('true', false)).toBe(true);
    expect(readFlag('0', true)).toBe(false);
    expect(readFlag(null, true)).toBe(true);
    expect(readFlag('', false)).toBe(false);
  });
});

describe('cell values', () => {
  it('keeps numbers numeric for Excel', () => {
    expect(columnValue('price', row)).toBe(90);
    expect(columnValue('change', row)).toBe(-10);
    expect(columnValue('source', row)).toBe('list');
  });

  it('formats money, percentages and gaps for the PDF', () => {
    expect(columnText('price', row)).toBe('$90.00');
    expect(columnText('unlabeled', row)).toBe('$80.00');
    expect(columnText('change', row)).toBe('-10.0%');
    expect(columnText('change', { ...row, changePct: 12.5 })).toBe('+12.5%');
    expect(columnText('change', { ...row, changePct: 0 })).toBe('—');
    expect(columnText('change', { ...row, changePct: null })).toBe('—');
    expect(columnText('unlabeled', { ...row, unlabeledPrice: null })).toBe('—');
    expect(columnText('strength', { ...row, strength: '' })).toBe('—');
    expect(columnText('source', { ...row, onList: false })).toBe('Catalog');
  });
});
