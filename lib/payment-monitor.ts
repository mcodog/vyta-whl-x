import type { CryptoChain } from './crypto-wallets';

// Minimum confirmations required per chain
export const REQUIRED_CONFIRMATIONS: Record<CryptoChain, number> = {
  btc: 1,
  eth: 12,
  sol: 1,
};

interface PaymentResult {
  received: boolean;
  amount: string;
  txHash: string;
  confirmations: number;
  confirmed: boolean; // true if confirmations >= required
}

export async function checkPayment(
  chain: CryptoChain,
  address: string,
  expectedAmount: string
): Promise<PaymentResult | null> {
  try {
    switch (chain) {
      case 'btc': return await checkBtc(address, expectedAmount);
      case 'eth': return await checkEth(address, expectedAmount);
      case 'sol': return await checkSol(address, expectedAmount);
      default: return null;
    }
  } catch (err) {
    console.error(`Payment check failed for ${chain}/${address}:`, err);
    return null;
  }
}

function isEnough(received: number, expected: number): boolean {
  return received >= expected * 0.98;
}

// --- BTC (blockstream.info) ---

async function checkBtc(address: string, expectedAmount: string): Promise<PaymentResult | null> {
  const res = await fetch(`https://blockstream.info/api/address/${address}`);
  if (!res.ok) return null;

  const data = await res.json();
  const confirmedSats = data.chain_stats?.funded_txo_sum ?? 0;
  const unconfirmedSats = data.mempool_stats?.funded_txo_sum ?? 0;
  const totalBtc = (confirmedSats + unconfirmedSats) / 1e8;

  if (!isEnough(totalBtc, parseFloat(expectedAmount))) return null;

  // Get tx details including confirmation status
  const txRes = await fetch(`https://blockstream.info/api/address/${address}/txs`);
  const txs = txRes.ok ? await txRes.json() : [];
  const tx = txs[0];
  const txHash = tx?.txid || '';

  let confirmations = 0;
  if (tx?.status?.confirmed && tx?.status?.block_height) {
    // Get current block height
    const tipRes = await fetch('https://blockstream.info/api/blocks/tip/height');
    if (tipRes.ok) {
      const tipHeight = parseInt(await tipRes.text(), 10);
      confirmations = tipHeight - tx.status.block_height + 1;
    }
  }

  return {
    received: true,
    amount: totalBtc.toFixed(8),
    txHash,
    confirmations,
    confirmed: confirmations >= REQUIRED_CONFIRMATIONS.btc,
  };
}

// --- ETH (Alchemy) ---

async function checkEth(address: string, expectedAmount: string): Promise<PaymentResult | null> {
  const apiKey = process.env.ALCHEMY_ETH_API_KEY;
  if (!apiKey) throw new Error('ALCHEMY_ETH_API_KEY not configured');

  const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
  });
  if (!res.ok) return null;

  const data = await res.json();
  const balanceWei = BigInt(data.result || '0');
  const balanceEth = Number(balanceWei) / 1e18;

  if (!isEnough(balanceEth, parseFloat(expectedAmount))) return null;

  // Get latest tx
  const txRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers',
      params: [{ fromBlock: '0x0', toBlock: 'latest', toAddress: address, category: ['external'], maxCount: '0x1', order: 'desc' }],
    }),
  });
  const txData = txRes.ok ? await txRes.json() : { result: { transfers: [] } };
  const transfer = txData.result?.transfers?.[0];
  const txHash = transfer?.hash || '';

  let confirmations = 0;
  if (txHash) {
    // Get tx receipt for block number
    const receiptRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
    });
    const receiptData = receiptRes.ok ? await receiptRes.json() : null;
    const txBlockHex = receiptData?.result?.blockNumber;

    if (txBlockHex) {
      // Get current block number
      const blockRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [],
        }),
      });
      const blockData = blockRes.ok ? await blockRes.json() : null;
      if (blockData?.result) {
        const txBlock = parseInt(txBlockHex, 16);
        const currentBlock = parseInt(blockData.result, 16);
        confirmations = currentBlock - txBlock + 1;
      }
    }
  }

  return {
    received: true,
    amount: balanceEth.toFixed(6),
    txHash,
    confirmations,
    confirmed: confirmations >= REQUIRED_CONFIRMATIONS.eth,
  };
}

// --- SOL (Alchemy) ---

async function checkSol(address: string, expectedAmount: string): Promise<PaymentResult | null> {
  const apiKey = process.env.ALCHEMY_SOL_API_KEY;
  if (!apiKey) throw new Error('ALCHEMY_SOL_API_KEY not configured');

  const rpcUrl = `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`;

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getBalance',
      params: [address],
    }),
  });
  if (!res.ok) return null;

  const data = await res.json();
  const lamports = data.result?.value ?? 0;
  const sol = lamports / 1e9;

  if (!isEnough(sol, parseFloat(expectedAmount))) return null;

  const sigRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress',
      params: [address, { limit: 1 }],
    }),
  });
  const sigData = sigRes.ok ? await sigRes.json() : { result: [] };
  const sig = sigData.result?.[0];
  const txHash = sig?.signature || '';

  // Solana: if tx is finalized (confirmationStatus === 'finalized'), it has max confirmations
  const confirmations = sig?.confirmationStatus === 'finalized' ? 32 : (sig?.confirmationStatus === 'confirmed' ? 1 : 0);

  return {
    received: true,
    amount: sol.toFixed(4),
    txHash,
    confirmations,
    confirmed: confirmations >= REQUIRED_CONFIRMATIONS.sol,
  };
}
