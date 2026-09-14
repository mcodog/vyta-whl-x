/**
 * SWEEP SCRIPT — Move funds from order addresses to your personal wallet
 *
 * Run locally: npx ts-node scripts/sweep.ts
 *
 * Supports: ETH, SOL, BTC
 *
 * This script:
 * 1. Asks for your 24-word seed phrase
 * 2. Asks for your destination wallet address
 * 3. Queries Supabase for ALL orders with payment addresses
 * 4. Checks balances on each address
 * 5. Sweeps funds to YOUR wallet address
 *
 * YOUR SEED PHRASE NEVER LEAVES YOUR MACHINE.
 */

import * as bip39 from "bip39";
import { ethers } from "ethers";
import { Keypair, Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { derivePath } from "ed25519-hd-key";
import BIP32Factory from "bip32";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { Buffer } from "buffer";
import * as readline from "readline";

const bip32 = BIP32Factory(ecc);

const SUPABASE_URL = "https://swpcvpkcfxihxmjpjqow.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3cGN2cGtjZnhpaHhtanBqcW93Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzQ4MTM1MSwiZXhwIjoyMDc5MDU3MzUxfQ.N9QjRH4xs27BUNL1G_JsxMsXkpz3nGoeI8CABzdnvAo";

const ETH_RPC = "https://eth-mainnet.public.blastapi.io";
const SOL_RPC = "https://api.mainnet-beta.solana.com";

async function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

interface OrderRow {
  payment_derivation_index: number;
  crypto: string;
  payment_address: string;
}

async function getAllOrders(): Promise<OrderRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/orders?select=payment_derivation_index,crypto,payment_address&payment_address=not.is.null`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  return res.json();
}

async function getSolAddressIndex(address: string): Promise<number | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sol_addresses?select=derivation_index&address=eq.${address}&limit=1`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  const data = await res.json();
  return data?.[0]?.derivation_index ?? null;
}

// --- ETH SWEEP ---

async function sweepEth(seed: Buffer, orders: OrderRow[], destAddress: string) {
  const ethOrders = orders.filter((o) => o.crypto === "eth");
  if (ethOrders.length === 0) {
    console.log("\n  No ETH orders to sweep.");
    return;
  }

  console.log(`\n  Destination: ${destAddress}`);
  console.log(`  Found ${ethOrders.length} ETH order(s) to check.\n`);

  const hdNode = ethers.HDNodeWallet.fromSeed(seed);
  const provider = new ethers.JsonRpcProvider(ETH_RPC);
  let totalSwept = BigInt(0);
  let sweptCount = 0;

  for (const order of ethOrders) {
    const idx = order.payment_derivation_index;
    const childWallet = hdNode.derivePath(`m/44'/60'/0'/0/${idx}`).connect(provider);
    const balance = await provider.getBalance(childWallet.address);

    if (balance === BigInt(0)) {
      console.log(`  [${idx}] ${childWallet.address} — empty`);
      continue;
    }

    const balanceEth = ethers.formatEther(balance);
    console.log(`  [${idx}] ${childWallet.address} — ${balanceEth} ETH`);

    const feeData = await provider.getFeeData();
    const gasLimit = BigInt(21000);
    const gasPrice = feeData.gasPrice || BigInt(0);
    const gasCost = gasLimit * gasPrice;

    if (balance <= gasCost) {
      console.log(`       Dust (less than gas), skipping`);
      continue;
    }

    const sendAmount = balance - gasCost;
    const confirm = await askQuestion(`       Sweep ${ethers.formatEther(sendAmount)} ETH to ${destAddress}? (y/n): `);
    if (confirm.toLowerCase() !== "y") { console.log("       Skipped."); continue; }

    try {
      const tx = await childWallet.sendTransaction({ to: destAddress, value: sendAmount, gasLimit, gasPrice });
      console.log(`       TX: ${tx.hash}`);
      await tx.wait();
      console.log(`       Confirmed!`);
      totalSwept += sendAmount;
      sweptCount++;
    } catch (err: any) {
      console.error(`       Failed: ${err.message}`);
    }
  }

  if (sweptCount > 0) {
    console.log(`\n  Swept ${ethers.formatEther(totalSwept)} ETH from ${sweptCount} address(es)`);
  }
}

// --- SOL SWEEP ---

async function sweepSol(seed: Buffer, orders: OrderRow[], destAddress: string) {
  const solOrders = orders.filter((o) => o.crypto === "sol");
  if (solOrders.length === 0) {
    console.log("\n  No SOL orders to sweep.");
    return;
  }

  const destPubkey = new PublicKey(destAddress);
  console.log(`\n  Destination: ${destAddress}`);
  console.log(`  Found ${solOrders.length} SOL order(s) to check.\n`);

  const seedHex = seed.toString("hex");
  const connection = new Connection(SOL_RPC, "confirmed");
  let totalSwept = 0;
  let sweptCount = 0;

  for (const order of solOrders) {
    let idx = order.payment_derivation_index;
    if (idx === null || idx === undefined) {
      const lookupIdx = await getSolAddressIndex(order.payment_address);
      if (lookupIdx === null) {
        console.log(`  [?] ${order.payment_address} — can't find derivation index, skipping`);
        continue;
      }
      idx = lookupIdx;
    }

    const path = `m/44'/501'/${idx}'/0'`;
    const derived = derivePath(path, seedHex);
    const keypair = Keypair.fromSeed(Uint8Array.from(derived.key));

    if (keypair.publicKey.toBase58() !== order.payment_address) {
      console.log(`  [${idx}] Address mismatch! Expected ${order.payment_address}, got ${keypair.publicKey.toBase58()} — skipping`);
      continue;
    }

    const balance = await connection.getBalance(keypair.publicKey);
    if (balance === 0) {
      console.log(`  [${idx}] ${keypair.publicKey.toBase58()} — empty`);
      continue;
    }

    const balanceSol = balance / LAMPORTS_PER_SOL;
    console.log(`  [${idx}] ${keypair.publicKey.toBase58()} — ${balanceSol} SOL`);

    const fee = 5000;
    if (balance <= fee) {
      console.log(`       Dust (less than fee), skipping`);
      continue;
    }

    const sendAmount = balance - fee;
    const sendSol = sendAmount / LAMPORTS_PER_SOL;
    const confirm = await askQuestion(`       Sweep ${sendSol} SOL to ${destAddress}? (y/n): `);
    if (confirm.toLowerCase() !== "y") { console.log("       Skipped."); continue; }

    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: destPubkey,
          lamports: sendAmount,
        })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = keypair.publicKey;
      tx.sign(keypair);

      const sig = await connection.sendRawTransaction(tx.serialize());
      console.log(`       TX: ${sig}`);
      await connection.confirmTransaction(sig, "confirmed");
      console.log(`       Confirmed!`);
      totalSwept += sendAmount;
      sweptCount++;
    } catch (err: any) {
      console.error(`       Failed: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  if (sweptCount > 0) {
    console.log(`\n  Swept ${totalSwept / LAMPORTS_PER_SOL} SOL from ${sweptCount} address(es)`);
  }
}

// --- BTC SWEEP ---

async function sweepBtc(seed: Buffer, orders: OrderRow[], destAddress: string) {
  const btcOrders = orders.filter((o) => o.crypto === "btc");
  if (btcOrders.length === 0) {
    console.log("\n  No BTC orders to sweep.");
    return;
  }

  console.log(`\n  Destination: ${destAddress}`);
  console.log(`  Found ${btcOrders.length} BTC order(s) to check.\n`);

  const root = bip32.fromSeed(seed);
  const btcAccount = root.derivePath("m/84'/0'/0'");
  let totalSwept = 0;
  let sweptCount = 0;

  for (const order of btcOrders) {
    const idx = order.payment_derivation_index;
    const child = btcAccount.derive(0).derive(idx);
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(child.publicKey),
      network: bitcoin.networks.bitcoin,
    });

    if (!address) {
      console.log(`  [${idx}] Failed to derive address, skipping`);
      continue;
    }

    try {
      const utxoRes = await fetch(`https://mempool.space/api/address/${address}/utxo`);
      const utxos: { txid: string; vout: number; value: number }[] = await utxoRes.json();

      if (!utxos.length) {
        console.log(`  [${idx}] ${address} — empty`);
        continue;
      }

      const totalSats = utxos.reduce((sum, u) => sum + u.value, 0);
      const btcAmount = totalSats / 1e8;
      console.log(`  [${idx}] ${address} — ${btcAmount} BTC (${utxos.length} UTXO${utxos.length > 1 ? "s" : ""})`);

      const feeRes = await fetch("https://mempool.space/api/v1/fees/recommended");
      const fees: { halfHourFee: number } = await feeRes.json();
      const feeRate = fees.halfHourFee;

      const estimatedVBytes = Math.ceil(utxos.length * 68 + 31 + 10.5);
      const feeSats = estimatedVBytes * feeRate;

      if (totalSats <= feeSats) {
        console.log(`       Dust (${feeSats} sat fee > ${totalSats} sat balance), skipping`);
        continue;
      }

      const sendSats = totalSats - feeSats;
      const sendBtc = sendSats / 1e8;
      const confirm = await askQuestion(`       Sweep ${sendBtc} BTC to ${destAddress} (fee: ${feeSats} sats @ ${feeRate} sat/vB)? (y/n): `);
      if (confirm.toLowerCase() !== "y") { console.log("       Skipped."); continue; }

      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

      for (const utxo of utxos) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              pubkey: Buffer.from(child.publicKey),
              network: bitcoin.networks.bitcoin,
            }).output!,
            value: BigInt(utxo.value),
          },
        });
      }

      psbt.addOutput({
        address: destAddress,
        value: BigInt(sendSats),
      });

      for (let i = 0; i < utxos.length; i++) {
        psbt.signInput(i, child);
      }

      psbt.finalizeAllInputs();
      const txHex = psbt.extractTransaction().toHex();

      const broadcastRes = await fetch("https://mempool.space/api/tx", {
        method: "POST",
        body: txHex,
        headers: { "Content-Type": "text/plain" },
      });

      if (broadcastRes.ok) {
        const txid = await broadcastRes.text();
        console.log(`       TX: ${txid}`);
        console.log(`       Broadcast! Waiting for confirmation on-chain.`);
        totalSwept += sendSats;
        sweptCount++;
      } else {
        const errText = await broadcastRes.text();
        console.error(`       Broadcast failed: ${errText}`);
      }
    } catch (err: any) {
      console.error(`       Failed: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  if (sweptCount > 0) {
    console.log(`\n  Swept ${totalSwept / 1e8} BTC from ${sweptCount} address(es)`);
  }
}

// --- MAIN ---

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  AMINOCAN SWEEP — Collect Payments");
  console.log("  Supports: ETH, SOL, BTC");
  console.log("=".repeat(60));

  const mnemonic = await askQuestion("\nEnter your 24-word seed phrase: ");
  if (!bip39.validateMnemonic(mnemonic)) {
    console.error("Invalid mnemonic.");
    process.exit(1);
  }

  const seed = await bip39.mnemonicToSeed(mnemonic);

  const chain = await askQuestion("\nSweep which chain? (eth/sol/btc/all): ");

  const orders = await getAllOrders();
  console.log(`\nFound ${orders.length} total order(s) in database.`);

  if (chain === "eth" || chain === "all") {
    const dest = await askQuestion("\nETH destination address: ");
    if (!dest) { console.error("No address provided."); } else {
      console.log("\n" + "-".repeat(60));
      console.log("  ETH SWEEP");
      console.log("-".repeat(60));
      await sweepEth(Buffer.from(seed), orders, dest);
    }
  }

  if (chain === "sol" || chain === "all") {
    const dest = await askQuestion("\nSOL destination address: ");
    if (!dest) { console.error("No address provided."); } else {
      console.log("\n" + "-".repeat(60));
      console.log("  SOL SWEEP");
      console.log("-".repeat(60));
      await sweepSol(Buffer.from(seed), orders, dest);
    }
  }

  if (chain === "btc" || chain === "all") {
    const dest = await askQuestion("\nBTC destination address: ");
    if (!dest) { console.error("No address provided."); } else {
      console.log("\n" + "-".repeat(60));
      console.log("  BTC SWEEP");
      console.log("-".repeat(60));
      await sweepBtc(Buffer.from(seed), orders, dest);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("  SWEEP COMPLETE");
  console.log("=".repeat(60) + "\n");
}

main().catch(console.error);
