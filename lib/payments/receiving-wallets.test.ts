import { describe, expect, it } from 'vitest';
import { findBitcoinWallet } from './receiving-wallets';

/**
 * Picking the Bitcoin wallet out of the configured receiving wallets.
 *
 * The address this finds is printed in a customer's payment instructions, so
 * the two ways it can be wrong are both expensive: picking a wallet on another
 * chain sends their money somewhere unrecoverable, and finding nothing at all
 * costs the store an order it could have collected. The rows are free text an
 * admin typed, so matching has to be generous about wording and strict about
 * which coin it actually is.
 */

const wallet = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  label: 'Bitcoin',
  network: 'Bitcoin',
  address: 'bc1qexampleaddress',
  memo: '',
  enabled: true,
  ...over,
});

describe('findBitcoinWallet', () => {
  it('finds a wallet by its label', () => {
    expect(findBitcoinWallet([wallet({ label: 'BTC' })])?.address).toBe(
      'bc1qexampleaddress',
    );
    expect(
      findBitcoinWallet([wallet({ label: 'Bitcoin (Native SegWit)' })])?.address,
    ).toBe('bc1qexampleaddress');
  });

  it('finds a wallet named by its network alone', () => {
    const row = wallet({ label: 'Main wallet', network: 'Bitcoin' });
    expect(findBitcoinWallet([row])?.address).toBe('bc1qexampleaddress');
  });

  it('skips other chains rather than paying them', () => {
    const usdt = wallet({ id: 'w2', label: 'USDT (TRC-20)', network: 'Tron' });
    const eth = wallet({ id: 'w3', label: 'Ethereum', network: 'ERC-20' });
    expect(findBitcoinWallet([usdt, eth])).toBeNull();
  });

  it('does not match a ticker that merely contains the letters', () => {
    // Bitcoin Cash is a different chain; funds sent to it are not recoverable.
    const bch = wallet({ id: 'w4', label: 'BCH', network: 'Bitcoin Cash' });
    expect(findBitcoinWallet([bch])).toBeNull();
  });

  it('ignores a disabled wallet', () => {
    expect(findBitcoinWallet([wallet({ enabled: false })])).toBeNull();
  });

  it('returns null when nothing is configured', () => {
    expect(findBitcoinWallet(null)).toBeNull();
    expect(findBitcoinWallet([])).toBeNull();
    expect(findBitcoinWallet('not a list')).toBeNull();
  });

  it('takes the first Bitcoin wallet in the configured order', () => {
    const first = wallet({ id: 'w1', address: 'bc1first' });
    const second = wallet({ id: 'w2', address: 'bc1second' });
    expect(findBitcoinWallet([first, second])?.address).toBe('bc1first');
  });
});
