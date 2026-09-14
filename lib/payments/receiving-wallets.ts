/**
 * Receiving crypto wallets — the addresses a customer may send an invoice
 * payment to, configured in admin Settings → "Crypto Payments" and stored on
 * `site_settings.crypto_wallets`.
 *
 * These are PUBLIC by nature: the address is printed on the crypto instructions
 * page and copied by the customer. No keys or secrets live here — this is only
 * the "send money to this address" side. (The HD-derivation helpers used by the
 * legacy per-order crypto checkout are a different thing entirely and live in
 * `lib/crypto-wallets.ts`.)
 *
 * Safe to import from both client and server code.
 */

export interface ReceivingWallet {
  /** Stable id used to record which wallet a customer was shown. */
  id: string;
  /** Display name, e.g. "USDT (TRC-20)". */
  label: string;
  /** Network/chain the address lives on, e.g. "Tron (TRC-20)". */
  network: string;
  /** The receiving address itself. */
  address: string;
  /** Optional memo/tag/destination-tag some chains require. */
  memo: string;
  /** Off hides the wallet from the payment page without deleting it. */
  enabled: boolean;
}

/** A blank wallet row for the Settings editor. */
export function emptyReceivingWallet(id: string): ReceivingWallet {
  return { id, label: '', network: '', address: '', memo: '', enabled: true };
}

/**
 * Coerce whatever is stored in `site_settings.crypto_wallets` into a clean
 * list. Tolerant by design: a malformed row is dropped rather than throwing, so
 * a bad edit can never break the customer's payment page. Rows without a label
 * or address are dropped (there'd be nothing to show); ids are backfilled from
 * the row index so pre-existing rows without one still round-trip.
 */
export function normaliseReceivingWallets(value: unknown): ReceivingWallet[] {
  if (!Array.isArray(value)) return [];
  const out: ReceivingWallet[] = [];
  const seen = new Set<string>();
  value.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const w = raw as Record<string, unknown>;
    const label = typeof w.label === 'string' ? w.label.trim() : '';
    const address = typeof w.address === 'string' ? w.address.trim() : '';
    if (!label || !address) return;
    let id = typeof w.id === 'string' && w.id.trim() ? w.id.trim() : `w${i + 1}`;
    // Ids must be unique — they key the "which wallet did we show them" record.
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    out.push({
      id,
      label: label.slice(0, 80),
      network: typeof w.network === 'string' ? w.network.trim().slice(0, 80) : '',
      address: address.slice(0, 200),
      memo: typeof w.memo === 'string' ? w.memo.trim().slice(0, 120) : '',
      // Absent `enabled` reads as on, so a hand-written row works.
      enabled: w.enabled === undefined ? true : Boolean(w.enabled),
    });
  });
  return out;
}

/** The wallets actually offered to a customer (enabled, in configured order). */
export function activeReceivingWallets(value: unknown): ReceivingWallet[] {
  return normaliseReceivingWallets(value).filter((w) => w.enabled);
}

/** Wallets whose name says Bitcoin, matched on whole words. */
const BITCOIN_NAME = /\b(btc|bitcoin)\b/i;
/**
 * Forks that borrow the name. Sending BTC to one of these is unrecoverable, so
 * a wallet whose name mentions any of them is never treated as Bitcoin — even
 * though "Bitcoin Cash" contains "Bitcoin".
 */
const BITCOIN_FORK = /\b(bch|bsv|btg|bitcoin\s+(cash|sv|gold))\b/i;

/**
 * The Bitcoin receiving wallet, if one is configured and enabled.
 *
 * Wallets are free-text rows (a label, a network), so a Bitcoin one is
 * recognised by what the admin called it: "BTC", "Bitcoin", "Bitcoin (Native
 * SegWit)" all match, while "USDT (TRC-20)" and "Bitcoin Cash" do not. Where
 * several match, the first in the configured order wins.
 *
 * Used to fill the deposit address into the Bitcoin payment instructions a
 * customer is emailed after ordering. Returns null when nothing is configured —
 * the email then says the address will follow rather than inventing one.
 */
export function findBitcoinWallet(value: unknown): ReceivingWallet | null {
  return (
    activeReceivingWallets(value).find((w) => {
      const name = `${w.label} ${w.network}`;
      return !BITCOIN_FORK.test(name) && BITCOIN_NAME.test(name);
    }) ?? null
  );
}
