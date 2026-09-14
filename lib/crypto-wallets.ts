import BIP32Factory from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { Buffer } from 'buffer';
import { getSupabase } from './supabase';

const bip32 = BIP32Factory(ecc);

export type CryptoChain = 'btc' | 'eth' | 'sol';

export function deriveBtcAddress(index: number): string {
  const xpub = process.env.BTC_XPUB;
  if (!xpub) throw new Error('BTC_XPUB not configured');
  const node = bip32.fromBase58(xpub);
  const child = node.derive(0).derive(index);
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: bitcoin.networks.bitcoin,
  });
  if (!address) throw new Error('Failed to derive BTC address');
  return address;
}

export function deriveEthAddress(index: number): string {
  const xpub = process.env.ETH_XPUB;
  if (!xpub) throw new Error('ETH_XPUB not configured');
  const node = ethers.HDNodeWallet.fromExtendedKey(xpub);
  const child = node.derivePath(`0/${index}`);
  return child.address;
}

export async function claimSolAddress(orderId: string): Promise<string> {
  const db = getSupabase();
  const { data, error } = await db
    .from('sol_addresses')
    .select('id, address')
    .eq('used', false)
    .order('id', { ascending: true })
    .limit(1)
    .single();

  if (error || !data) throw new Error('No unused SOL addresses available');

  await db
    .from('sol_addresses')
    .update({ used: true, order_id: orderId })
    .eq('id', data.id);

  return data.address;
}

export async function getNextIndex(chain: CryptoChain): Promise<number> {
  const db = getSupabase();
  const { data } = await db
    .from('orders')
    .select('payment_derivation_index')
    .eq('crypto', chain)
    .not('payment_derivation_index', 'is', null)
    .order('payment_derivation_index', { ascending: false })
    .limit(1);

  const maxIndex = data?.[0]?.payment_derivation_index ?? 0;
  return maxIndex + 1;
}

export async function deriveAddress(
  chain: CryptoChain,
  index: number,
  orderId?: string
): Promise<string> {
  switch (chain) {
    case 'btc':
      return deriveBtcAddress(index);
    case 'eth':
      return deriveEthAddress(index);
    case 'sol':
      if (!orderId) throw new Error('orderId required for SOL');
      return claimSolAddress(orderId);
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}
