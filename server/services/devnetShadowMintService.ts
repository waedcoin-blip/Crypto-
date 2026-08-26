import { Connection, PublicKey, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  MintLayout,
  createInitializeMintInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import { adminDb } from '../utils/firebaseAdmin';
import { getSettlementKeypair } from '../routes/devnetSwap';

export interface ShadowMintRecord {
  originalMint: string;
  devnetMint: string;
  decimals: number;
  createdAt?: string;
}

const memoryShadowMap = new Map<string, ShadowMintRecord>();
let loadedFromDb = false;

const DISK_CACHE_PATH = path.join(process.cwd(), 'data', 'devnetShadowMints.json');

function loadFromDiskCache(): void {
  try {
    if (fs.existsSync(DISK_CACHE_PATH)) {
      const raw = fs.readFileSync(DISK_CACHE_PATH, 'utf8');
      const data: Record<string, ShadowMintRecord> = JSON.parse(raw);
      Object.entries(data).forEach(([key, record]) => {
        if (record.originalMint && record.devnetMint) {
          memoryShadowMap.set(key, record);
        }
      });
    }
  } catch (err: any) {
    console.warn('[DevnetShadowMint] Could not load shadow mints from disk cache:', err.message);
  }
}

function saveToDiskCache(): void {
  try {
    const dir = path.dirname(DISK_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: Record<string, ShadowMintRecord> = {};
    memoryShadowMap.forEach((val, key) => {
      data[key] = val;
    });
    fs.writeFileSync(DISK_CACHE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err: any) {
    console.warn('[DevnetShadowMint] Could not save shadow mints to disk cache:', err.message);
  }
}

// Initial load from disk cache on startup
loadFromDiskCache();

export async function getAllShadowMints(): Promise<Record<string, ShadowMintRecord>> {
  if (!loadedFromDb && adminDb) {
    try {
      const snap = await adminDb.collection('devnetShadowMints').get();
      snap.forEach((doc) => {
        const data = doc.data() as ShadowMintRecord;
        if (data.originalMint && data.devnetMint) {
          memoryShadowMap.set(data.originalMint, data);
        }
      });
      loadedFromDb = true;
      saveToDiskCache();
    } catch (err: any) {
      // Gracefully handle PERMISSION_DENIED or uninitialized adminDb
      if (err?.code === 7 || err?.message?.includes('PERMISSION_DENIED')) {
        console.info('[DevnetShadowMint] Firestore permissions restricted. Relying on local storage for shadow mints.');
      } else {
        console.warn('[DevnetShadowMint] Could not load shadow mints from Firestore:', err.message || err);
      }
      loadedFromDb = true; // Mark loaded to prevent repeated error logs
    }
  }

  const result: Record<string, ShadowMintRecord> = {};
  memoryShadowMap.forEach((val, key) => {
    result[key] = val;
  });
  return result;
}

export async function getShadowMintMapping(originalMintStr: string): Promise<ShadowMintRecord | null> {
  if (memoryShadowMap.has(originalMintStr)) {
    return memoryShadowMap.get(originalMintStr)!;
  }

  if (adminDb) {
    try {
      const doc = await adminDb.collection('devnetShadowMints').doc(originalMintStr).get();
      if (doc.exists) {
        const record = doc.data() as ShadowMintRecord;
        memoryShadowMap.set(originalMintStr, record);
        saveToDiskCache();
        return record;
      }
    } catch (err: any) {
      if (err?.code !== 7 && !err?.message?.includes('PERMISSION_DENIED')) {
        console.warn(`[DevnetShadowMint] Error checking Firestore for ${originalMintStr}:`, err.message || err);
      }
    }
  }

  return null;
}

async function fetchMainnetDecimals(originalMintStr: string): Promise<number> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${originalMintStr}`);
    if (res.ok) {
      const data = await res.json();
      const pair = data.pairs?.[0];
      if (pair?.baseToken?.address === originalMintStr && typeof pair.baseToken.decimals === 'number') {
        return pair.baseToken.decimals;
      }
      if (pair?.quoteToken?.address === originalMintStr && typeof pair.quoteToken.decimals === 'number') {
        return pair.quoteToken.decimals;
      }
    }
  } catch (e) {
    console.warn(`[DevnetShadowMint] DexScreener decimals fetch failed for ${originalMintStr}, defaulting to 6`);
  }
  return 6;
}

export async function getOrCreateShadowMint(
  connection: Connection,
  originalMintStr: string
): Promise<ShadowMintRecord> {
  // Check if mapping exists
  const existing = await getShadowMintMapping(originalMintStr);
  if (existing) {
    // Best-effort inventory top-up
    void topUpShadowMintIfNeeded(connection, existing);
    return existing;
  }

  const { keypair: settlementKp } = getSettlementKeypair();
  if (!settlementKp) {
    throw new Error('Settlement keypair unavailable to create Devnet shadow mint');
  }

  const decimals = await fetchMainnetDecimals(originalMintStr);
  const shadowMintKp = Keypair.generate();
  const devnetMintPk = shadowMintKp.publicKey;
  const settlementPk = settlementKp.publicKey;

  console.log(
    `[DevnetShadowMint] Creating new Devnet Shadow Mint for ${originalMintStr} -> ${devnetMintPk.toBase58()} (Decimals: ${decimals})`
  );

  const settlementAta = getAssociatedTokenAddressSync(devnetMintPk, settlementPk, true, TOKEN_PROGRAM_ID);
  const rentLamports = await connection.getMinimumBalanceForRentExemption(MintLayout.span);

  const instructions = [
    // 1. Create account for shadow mint
    SystemProgram.createAccount({
      fromPubkey: settlementPk,
      newAccountPubkey: devnetMintPk,
      lamports: rentLamports,
      space: MintLayout.span,
      programId: TOKEN_PROGRAM_ID,
    }),
    // 2. Initialize mint
    createInitializeMintInstruction(devnetMintPk, decimals, settlementPk, settlementPk, TOKEN_PROGRAM_ID),
    // 3. Ensure settlement ATA exists
    createAssociatedTokenAccountIdempotentInstruction(
      settlementPk,
      settlementAta,
      settlementPk,
      devnetMintPk,
      TOKEN_PROGRAM_ID
    ),
    // 4. Mint 1,000,000,000 tokens working supply into settlement ATA
    createMintToInstruction(
      devnetMintPk,
      settlementAta,
      settlementPk,
      BigInt(1_000_000_000) * BigInt(Math.pow(10, decimals)),
      [],
      TOKEN_PROGRAM_ID
    ),
  ];

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const messageV0 = new TransactionMessage({
    payerKey: settlementPk,
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([settlementKp, shadowMintKp]);

  const rawTx = tx.serialize();
  const sig = await connection.sendRawTransaction(rawTx, { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, ...latestBlockhash }, 'confirmed');

  console.log(`[DevnetShadowMint] Devnet Shadow Mint created successfully! Signature: ${sig}`);

  const record: ShadowMintRecord = {
    originalMint: originalMintStr,
    devnetMint: devnetMintPk.toBase58(),
    decimals,
    createdAt: new Date().toISOString(),
  };

  memoryShadowMap.set(originalMintStr, record);
  saveToDiskCache();

  if (adminDb) {
    try {
      await adminDb.collection('devnetShadowMints').doc(originalMintStr).set(record);
      console.log(`[DevnetShadowMint] Saved shadow mint mapping to Firestore for ${originalMintStr}`);
    } catch (err: any) {
      if (err?.code !== 7 && !err?.message?.includes('PERMISSION_DENIED')) {
        console.warn('[DevnetShadowMint] Failed to save shadow mint mapping to Firestore:', err.message || err);
      }
    }
  }

  return record;
}

async function topUpShadowMintIfNeeded(connection: Connection, record: ShadowMintRecord): Promise<void> {
  try {
    const { keypair: settlementKp } = getSettlementKeypair();
    if (!settlementKp) return;

    const devnetMintPk = new PublicKey(record.devnetMint);
    const settlementPk = settlementKp.publicKey;
    const settlementAta = getAssociatedTokenAddressSync(devnetMintPk, settlementPk, true, TOKEN_PROGRAM_ID);

    const accountInfo = await connection.getParsedAccountInfo(settlementAta, 'confirmed');
    const balanceStr = (accountInfo.value?.data as any)?.parsed?.info?.tokenAmount?.amount;
    const currentBalance = balanceStr ? BigInt(balanceStr) : 0n;
    const threshold = BigInt(100_000) * BigInt(Math.pow(10, record.decimals));

    if (currentBalance < threshold) {
      console.log(`[DevnetShadowMint] Inventory low for ${record.originalMint} (${currentBalance.toString()}). Topping up...`);
      const topUpAmount = BigInt(1_000_000_000) * BigInt(Math.pow(10, record.decimals));

      const instructions = [
        createAssociatedTokenAccountIdempotentInstruction(
          settlementPk,
          settlementAta,
          settlementPk,
          devnetMintPk,
          TOKEN_PROGRAM_ID
        ),
        createMintToInstruction(devnetMintPk, settlementAta, settlementPk, topUpAmount, [], TOKEN_PROGRAM_ID),
      ];

      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const messageV0 = new TransactionMessage({
        payerKey: settlementPk,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
      }).compileToV0Message();

      const tx = new VersionedTransaction(messageV0);
      tx.sign([settlementKp]);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await connection.confirmTransaction({ signature: sig, ...latestBlockhash }, 'confirmed');
      console.log(`[DevnetShadowMint] Top up complete: ${sig}`);
    }
  } catch (err: any) {
    console.warn(`[DevnetShadowMint] Top up check failed for ${record.originalMint}:`, err.message);
  }
}
