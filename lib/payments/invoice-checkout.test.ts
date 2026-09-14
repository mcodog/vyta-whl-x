import { describe, expect, it, vi } from 'vitest';
import {
  handOffMatchesInvoice,
  loadPendingInvoiceHandOff,
  supersedePendingInvoiceHandOffs,
  SUPERSEDED_HANDOFF_STATUS,
} from './invoice-checkout';

/**
 * The hand-off bookkeeping behind an invoice's Stealth Health checkout link.
 *
 * Two behaviours matter and are easy to get wrong:
 *   - a pending link is only reusable while it would still charge what the
 *     invoice now says, and
 *   - minting a replacement must retire the old row, or the admin panel and the
 *     payment page disagree about which link is live.
 */

const LINES = [
  { sku: 'puramass-a-case', quantity: 2, unit_price_cents: 14900 },
  { sku: 'puramass-b-vial', quantity: 3, unit_price_cents: 3200 },
];

describe('handOffMatchesInvoice', () => {
  it('matches when the same lines and shipping come back in another order', () => {
    const row = { items: [LINES[1], LINES[0]], shipping_total_cents: 0 };
    expect(handOffMatchesInvoice(row, LINES, 0)).toBe(true);
  });

  it('rejects a changed quantity, price, or line count', () => {
    expect(
      handOffMatchesInvoice({ items: [{ ...LINES[0], quantity: 3 }, LINES[1]], shipping_total_cents: 0 }, LINES, 0),
    ).toBe(false);
    expect(
      handOffMatchesInvoice(
        { items: [{ ...LINES[0], unit_price_cents: 100 }, LINES[1]], shipping_total_cents: 0 },
        LINES,
        0,
      ),
    ).toBe(false);
    expect(handOffMatchesInvoice({ items: [LINES[0]], shipping_total_cents: 0 }, LINES, 0)).toBe(false);
  });

  it('rejects changed shipping — the link bakes in the amount we sent', () => {
    expect(handOffMatchesInvoice({ items: LINES, shipping_total_cents: 0 }, LINES, 3500)).toBe(false);
    expect(handOffMatchesInvoice({ items: LINES, shipping_total_cents: 3500 }, LINES, 3500)).toBe(true);
  });

  it('treats an unrecorded shipping amount as "nothing to compare", not free', () => {
    expect(handOffMatchesInvoice({ items: LINES, shipping_total_cents: null }, LINES, 3500)).toBe(true);
    expect(handOffMatchesInvoice({ items: LINES }, LINES, 3500)).toBe(true);
  });

  it('rejects a row whose items were never recorded', () => {
    expect(handOffMatchesInvoice({ items: null, shipping_total_cents: 0 }, LINES, 0)).toBe(false);
  });
});

/**
 * A Supabase double for `puramass_orders` that records the filters it was
 * given, and can fail the first (origin-aware) attempt the way a database
 * that never ran the payment-request migration would.
 */
function fakeDb(opts: { rows?: any[]; failWithOrigin?: boolean } = {}) {
  const { rows = [], failWithOrigin = false } = opts;
  const calls: any[] = [];
  const db: any = {
    calls,
    from() {
      const call: any = { filters: {}, update: null, withOrigin: false };
      calls.push(call);
      const settle = () =>
        call.withOrigin && failWithOrigin
          ? { data: null, error: { message: 'column "origin" does not exist' } }
          : { data: rows, error: null };
      const chain: any = {
        select: () => chain,
        update: (patch: any) => {
          call.update = patch;
          return chain;
        },
        eq: (col: string, val: unknown) => {
          call.filters[col] = val;
          if (col === 'origin') call.withOrigin = true;
          return chain;
        },
        neq: (col: string, val: unknown) => {
          call.filters[`neq:${col}`] = val;
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          call.filters[col] = vals;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          const r = settle();
          return r.error ? r : { data: rows[0] ?? null, error: null };
        },
        then: (res: any, rej: any) => Promise.resolve(settle()).then(res, rej),
      };
      return chain;
    },
  };
  return db;
}

describe('loadPendingInvoiceHandOff', () => {
  it('reads only in-flight invoice hand-offs', async () => {
    const db = fakeDb({ rows: [{ id: 'h1', status: 'payment_pending' }] });
    const row = await loadPendingInvoiceHandOff(db, 'inv1');
    expect(row?.id).toBe('h1');
    expect(db.calls[0].filters).toMatchObject({
      invoice_id: 'inv1',
      origin: 'invoice',
      status: ['payment_pending'],
    });
  });

  it('falls back to the pre-migration columns when the wide select fails', async () => {
    const db = fakeDb({ rows: [{ id: 'h1' }], failWithOrigin: true });
    // The origin filter is on both attempts, so both fail here — the point is
    // that it retries rather than throwing.
    await expect(loadPendingInvoiceHandOff(db, 'inv1')).resolves.toBe(null);
    expect(db.calls.length).toBe(2);
  });
});

describe('supersedePendingInvoiceHandOffs', () => {
  it('parks pending rows at superseded, skipping the row just created', async () => {
    const db = fakeDb({ rows: [{ id: 'old', transaction_id: 'txn_old' }] });
    const retired = await supersedePendingInvoiceHandOffs(db, 'inv1', { exceptId: 'new' });
    expect(retired.map((r) => r.id)).toEqual(['old']);
    expect(db.calls[0].update).toEqual({ status: SUPERSEDED_HANDOFF_STATUS });
    expect(db.calls[0].filters).toMatchObject({
      invoice_id: 'inv1',
      status: ['payment_pending'],
      'neq:id': 'new',
    });
  });

  it('retries without the origin filter on a pre-migration database', async () => {
    const db = fakeDb({ rows: [{ id: 'old' }], failWithOrigin: true });
    const retired = await supersedePendingInvoiceHandOffs(db, 'inv1');
    expect(retired.map((r) => r.id)).toEqual(['old']);
    expect(db.calls[0].withOrigin).toBe(true);
    expect(db.calls[1].withOrigin).toBe(false);
  });

  it('never throws — losing the old row must not cost the new link', async () => {
    const boom: any = {
      from() {
        throw new Error('connection lost');
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(supersedePendingInvoiceHandOffs(boom, 'inv1')).resolves.toEqual([]);
    spy.mockRestore();
  });
});
