/**
 * ONE-TIME WALLET GENERATION SCRIPT
 *
 * Run this ONCE locally: npx ts-node scripts/generate-wallets.ts
 *
 * It will:
 * 1. Generate a 24-word seed phrase (BIP-39 mnemonic)
 * 2. Derive xpubs for BTC, ETH
 * 3. Pre-generate 10,000 SOL addresses
 *
 * WRITE DOWN THE 24 WORDS ON PAPER. Store safely.
 * Import the seed into Exodus on your phone to access funds.
 * Copy the xpubs into .env.local on the server.
 *
 * The xpubs can only GENERATE receive addresses. They CANNOT spend.
 */

import * as bip39 from "bip39";
import BIP32Factory from "bip32";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import { derivePath } from "ed25519-hd-key";
import { Buffer } from "buffer";

const bip32 = BIP32Factory(ecc);

async function main() {
  // Check for --recover flag: use existing mnemonic from stdin
  const isRecover = process.argv.includes("--recover");

  let mnemonic: string;

  if (isRecover) {
    // Read mnemonic from stdin
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    mnemonic = await new Promise<string>((resolve) => {
      rl.question("\nEnter your 24-word seed phrase: ", (answer: string) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    if (!bip39.validateMnemonic(mnemonic)) {
      console.error("Invalid mnemonic. Check your words and try again.");
      process.exit(1);
    }
    console.log("\nMnemonic valid. Recovering xpubs...");
  } else {
    mnemonic = bip39.generateMnemonic(256);
    console.log("\nYOUR 24-WORD SEED PHRASE:");
    console.log("-".repeat(60));
    console.log(`\n  ${mnemonic}\n`);
    console.log("-".repeat(60));
    console.log("WARNING: WRITE THIS DOWN ON PAPER. STORE IT SAFELY.");
    console.log("WARNING: NEVER STORE IT DIGITALLY. NEVER SHARE IT.");
    console.log("WARNING: ANYONE WITH THESE WORDS CAN SPEND YOUR FUNDS.");
    console.log("WARNING: IF YOU LOSE THESE WORDS, YOUR FUNDS ARE GONE FOREVER.\n");
  }

  const seed = await bip39.mnemonicToSeed(mnemonic);

  console.log("\n" + "=".repeat(60));
  console.log("  AMINOCAN WALLET GENERATION");
  console.log("=".repeat(60));

  // --- BTC (BIP-84, native SegWit) ---
  const btcRoot = bip32.fromSeed(seed);
  const btcAccount = btcRoot.derivePath("m/84'/0'/0'");
  const btcXpub = btcAccount.neutered().toBase58();

  // Verify first address
  const btcChild = btcAccount.derive(0).derive(0);
  const btcAddr = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(btcChild.publicKey),
    network: bitcoin.networks.bitcoin,
  }).address;

  console.log("XPUBS (copy these to .env.local):");
  console.log("-".repeat(60));
  console.log(`BTC_XPUB=${btcXpub}`);

  // --- ETH (BIP-44) ---
  const ethWallet = ethers.HDNodeWallet.fromSeed(seed);
  const ethAccount = ethWallet.derivePath("m/44'/60'/0'");
  const ethXpub = ethAccount.neuter().extendedKey;
  const ethAddr = ethAccount.derivePath("0/0").address;

  console.log(`ETH_XPUB=${ethXpub}`);
  console.log("-".repeat(60));

  // --- SOL (ed25519, pre-generate addresses) ---
  console.log("\nSOLANA ADDRESSES (first 20 shown, 10000 saved to sol_addresses.json):");
  console.log("-".repeat(60));

  const solAddresses: { address: string; derivation_index: number }[] = [];
  const seedHex = seed.toString("hex");

  for (let i = 0; i < 10000; i++) {
    const path = `m/44'/501'/${i}'/0'`;
    const derived = derivePath(path, seedHex);
    const keypair = Keypair.fromSeed(Uint8Array.from(derived.key));
    solAddresses.push({
      address: keypair.publicKey.toBase58(),
      derivation_index: i,
    });
    if (i < 20) {
      console.log(`  [${i}] ${keypair.publicKey.toBase58()}`);
    }
  }

  // Save SOL addresses to JSON file
  const fs = await import("fs");
  fs.writeFileSync(
    "scripts/sol_addresses.json",
    JSON.stringify(solAddresses, null, 2)
  );
  console.log(`\n10,000 SOL addresses saved to scripts/sol_addresses.json`);

  // Show verification addresses
  console.log("\nVERIFICATION (first address per chain - check these match Exodus):");
  console.log("-".repeat(60));
  console.log(`  BTC:  ${btcAddr}`);
  console.log(`  ETH:  ${ethAddr}`);
  console.log(`  SOL:  ${solAddresses[0].address}`);
  console.log("-".repeat(60));

  console.log("\nNEXT STEPS:");
  console.log("  1. Write down the 24 words on paper");
  console.log("  2. Import the seed phrase into Exodus on your phone");
  console.log("  3. Verify the first BTC/ETH/SOL addresses match above");
  console.log("  4. Copy the 2 XPUB lines into .env.local");
  console.log("  5. Load sol_addresses.json into the sol_addresses Supabase table");
  console.log("  6. DELETE this script output from your terminal history\n");
}

main().catch(console.error);
