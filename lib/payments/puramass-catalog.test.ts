import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  matchProductToPuramass,
  PURAMASS_VIAL_CATALOG_SNAPSHOT,
} from './puramass-catalog';

/**
 * The matcher auto-fills each product's `puramass_sku` for the admin sync. It
 * must anchor on the strength/dose (so it never crosses 10mg with 20mg) and be
 * forgiving of the storefront's slightly different product names (e.g.
 * "5-Amino 10mg" ↔ PuraMass "5-Amino-1MQ 10mg"). Anything genuinely ambiguous
 * is surfaced for a human rather than guessed.
 */
describe('normalizeName', () => {
  it('folds punctuation, case, and glues number+unit into one dose token', () => {
    expect(normalizeName('GHK-CU 50mg')).toBe('ghk cu 50mg');
    expect(normalizeName('HGH 191AA (Somatropin) 10 IU')).toBe('hgh 191aa somatropin 10iu');
    expect(normalizeName('Bacteriostatic Water 3mL')).toBe('bacteriostatic water 3ml');
    expect(normalizeName('Suntheanine®')).toBe('suntheanine');
  });
});

describe('matchProductToPuramass', () => {
  it('matches an exact catalog name', () => {
    const r = matchProductToPuramass('Retatrutide 10mg', '10mg');
    expect(r.status).toBe('exact');
    expect(r.sku).toBe('puramass-retatrutide-10mg-case');
  });

  it('matches when the storefront name is shorter than the catalog name', () => {
    // Storefront calls it "5-Amino 10mg"; PuraMass is "5-Amino-1MQ 10mg".
    const r = matchProductToPuramass('5-Amino 10mg', '10mg');
    expect(['exact', 'matched']).toContain(r.status);
    expect(r.sku).toBe('puramass-5-amino-1mq-10mg-case');
  });

  it('respects the dose — never crosses strengths', () => {
    const r = matchProductToPuramass('Retatrutide 20mg', '20mg');
    expect(r.sku).toBe('puramass-retatrutide-20mg-case');
    const r2 = matchProductToPuramass('BPC-157 5mg', '5mg');
    expect(r2.sku).toBe('puramass-bpc-157-5mg-case');
  });

  it('picks the tightest fit when several candidates share the dose', () => {
    // A bare "BPC 10mg" should land on BPC-157 10mg (adds one word) rather than
    // the longer "BPC + TB500 10mg (WOLVERINE)" (adds three).
    const r = matchProductToPuramass('BPC 10mg', '10mg');
    expect(r.status).toBe('matched');
    expect(r.sku).toBe('puramass-bpc-157-10mg-case');
  });

  it('keeps an exact catalog name exact even when longer variants exist', () => {
    const r = matchProductToPuramass('CJC-1295 without DAC 10mg', '10mg');
    expect(['exact', 'matched']).toContain(r.status);
    expect(r.sku).toBe('puramass-cjc-1295-without-dac-10mg-case');
  });

  it('matches HGH with an IU dose', () => {
    const r = matchProductToPuramass('HGH 191AA (Somatropin) 36 IU', '36 IU');
    expect(r.sku).toBe('puramass-hgh-191aa-somatropin-36-iu-case');
  });

  it('returns unmatched for a product with no PuraMass equivalent', () => {
    const r = matchProductToPuramass('Vitamin C', '1000mg');
    expect(r.status).toBe('unmatched');
    expect(r.sku).toBeNull();
  });

  it('reports ambiguity instead of guessing', () => {
    // Bare "GHRP 10mg" fits GHRP-2 Acetate 10mg and GHRP-6 Acetate 10mg
    // equally (each adds two words), so it must be flagged, not auto-picked.
    const r = matchProductToPuramass('GHRP 10mg', '10mg');
    expect(r.status).toBe('ambiguous');
    expect(r.sku).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(1);
  });
});

describe('matchProductToPuramass — single-vial catalog', () => {
  const vial = PURAMASS_VIAL_CATALOG_SNAPSHOT;

  it('maps to the vial SKU, not the case', () => {
    const r = matchProductToPuramass('Retatrutide 10mg', '10mg', vial);
    expect(r.sku).toBe('puramass-retatrutide-10mg-vial');
  });

  it('handles the WOLVERINE naming difference (box bpc-plus-tb500 vs vial bpc-tb500)', () => {
    const r = matchProductToPuramass('BPC+ TB500 10mg', '10mg', vial);
    expect(r.sku).toBe('puramass-bpc-tb500-10mg-wolverine-vial');
  });

  it('prefers the exact vial over a longer "Pen" variant', () => {
    // The vial catalog has both "Retatrutide 10mg" and "Retatrutide 10mg Pen".
    const r = matchProductToPuramass('Retatrutide 10mg', '10mg', vial);
    expect(r.status).toBe('exact');
    expect(r.sku).toBe('puramass-retatrutide-10mg-vial');
  });

  it('matches the storefront short name to the vial SKU', () => {
    const r = matchProductToPuramass('5-Amino 10mg', '10mg', vial);
    expect(r.sku).toBe('puramass-5-amino-1mq-10mg-vial');
  });
});
