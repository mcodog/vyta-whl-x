import type { CryptoChain } from './crypto-wallets';

const cache: Map<string, { price: number; ts: number }> = new Map();
const CACHE_TTL = 60_000;

const COIN_IDS: Record<string, string> = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
};

export async function getCryptoPrice(chain: CryptoChain): Promise<number> {
  const coinId = COIN_IDS[chain];
  if (!coinId) throw new Error(`No price feed for ${chain}`);

  const cached = cache.get(coinId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.price;

  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=cad`,
    { next: { revalidate: 60 } }
  );

  if (!res.ok) {
    if (cached) return cached.price;
    throw new Error(`CoinGecko API error: ${res.status}`);
  }

  const data = await res.json();
  const price = data[coinId]?.cad;
  if (!price) throw new Error(`No price data for ${coinId}`);

  cache.set(coinId, { price, ts: Date.now() });
  return price;
}

export async function cadToCrypto(cadAmount: number, chain: CryptoChain): Promise<string> {
  const price = await getCryptoPrice(chain);
  const cryptoAmount = cadAmount / price;

  const decimals: Record<string, number> = {
    btc: 8,
    eth: 6,
    sol: 4,
  };

  return cryptoAmount.toFixed(decimals[chain] ?? 6);
}
