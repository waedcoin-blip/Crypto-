import { Connection, PublicKey, Keypair, SystemProgram, TransactionMessage, VersionedTransaction, TransactionInstruction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  MintLayout,
  createInitializeMintInstruction,
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


export interface ShadowMintInitInfo {
  record: ShadowMintRecord;
  shadowMintKp?: Keypair;
  initInstructions: TransactionInstruction[];
}

export async function getOrCreateShadowMintInfo(
  connection: Connection,
  originalMintStr: string,
  payerPk: PublicKey,
  settlementPk: PublicKey
): Promise<ShadowMintInitInfo> {
  let record = await getShadowMintMapping(originalMintStr);
  let shadowMintKp: Keypair | undefined;
  let devnetMintPk: PublicKey;

  if (record) {
    devnetMintPk = new PublicKey(record.devnetMint);
  } else {
    shadowMintKp = Keypair.generate();
    devnetMintPk = shadowMintKp.publicKey;
    const configuredDecimals = Number(process.env.DEVNET_SHADOW_TOKEN_DECIMALS || '6');
    const decimals = Number.isInteger(configuredDecimals) && configuredDecimals >= 0 && configuredDecimals <= 9 ? configuredDecimals : 6;

    record = {
      originalMint: originalMintStr,
      devnetMint: devnetMintPk.toBase58(),
      decimals,
      createdAt: new Date().toISOString(),
    };

    memoryShadowMap.set(originalMintStr, record);
    saveToDiskCache();

    if (adminDb) {
      adminDb.collection('devnetShadowMints').doc(originalMintStr).set(record).catch(() => {});
    }
  }

  // Check if shadow mint account actually exists on-chain on Devnet
  const mintAccount = await connection.getAccountInfo(devnetMintPk, 'confirmed').catch(() => null);

  if (mintAccount) {
    // Already created on-chain!
    return { record, initInstructions: [] };
  }

  // Mint account does NOT exist on Devnet yet — generate creation instructions in atomic tx
  if (!shadowMintKp) {
    // Re-generate a new keypair if previous creation failed before landing on-chain
    shadowMintKp = Keypair.generate();
    devnetMintPk = shadowMintKp.publicKey;
    record.devnetMint = devnetMintPk.toBase58();
    memoryShadowMap.set(originalMintStr, record);
    saveToDiskCache();
  }

  console.log(
    `[DevnetShadowMint] Preparing atomic creation instructions for Devnet Shadow Mint ${originalMintStr} -> ${devnetMintPk.toBase58()} (Decimals: ${record.decimals})`
  );

  const rentLamports = await connection.getMinimumBalanceForRentExemption(MintLayout.span);

  const initInstructions: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: payerPk,
      newAccountPubkey: devnetMintPk,
      lamports: rentLamports,
      space: MintLayout.span,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      devnetMintPk, record.decimals, settlementPk, settlementPk, TOKEN_PROGRAM_ID
    ),
  ];

  return { record, shadowMintKp, initInstructions };
}

export async function getOrCreateShadowMint(
  connection: Connection,
  originalMintStr: string
): Promise<ShadowMintRecord> {
  const existing = await getShadowMintMapping(originalMintStr);
  if (existing) {
    return existing;
  }
  const { keypair: settlementKp } = getSettlementKeypair();
  if (!settlementKp) {
    throw new Error('Settlement keypair unavailable to create Devnet shadow mint');
  }
  const info = await getOrCreateShadowMintInfo(
    connection,
    originalMintStr,
    settlementKp.publicKey,
    settlementKp.publicKey
  );
  return info.record;
}

