import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  AccountLayout,
  createInitializeAccountInstruction,
  createTransferInstruction,
  createMintToInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';
import {
  getOrCreateShadowMintInfo,
  getOrCreateShadowMint,
  getAllShadowMints,
  ShadowMintRecord,
} from '../services/devnetShadowMintService';

const router = Router();

export const BUILD_ID = 'devnet-swap-v11-no-ata-two-wallets-2026-08-26';
export const TOKEN_PROGRAM_ID_STR = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID_STR = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const SETTLEMENT_KEYPAIR_PATH = path.join(process.cwd(), 'data', 'devnetSettlementKeypair.json');
let cachedDevnetSettlementKeypair: Keypair | null = null;

export function getSettlementKeypair(): { keypair: Keypair | null; isConfigured: boolean } {
  const raw = process.env.DEVNET_SETTLEMENT_PRIVATE_KEY;
  if (raw && raw.trim()) {
    try {
      const trimmed = raw.trim();
      let bytes: Uint8Array;
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        bytes = new Uint8Array(JSON.parse(trimmed));
      } else {
        bytes = bs58.decode(trimmed);
      }
      if (bytes.length === 64) {
        return { keypair: Keypair.fromSecretKey(bytes), isConfigured: true };
      } else if (bytes.length === 32) {
        return { keypair: Keypair.fromSeed(bytes), isConfigured: true };
      }
    } catch (err) {
      console.error('[DevnetSwap] Invalid DEVNET_SETTLEMENT_PRIVATE_KEY provided:', err);
    }
  }

  // Load from persistent server settlement keypair on disk if env var is unset
  if (!cachedDevnetSettlementKeypair) {
    try {
      if (fs.existsSync(SETTLEMENT_KEYPAIR_PATH)) {
        const rawKey = fs.readFileSync(SETTLEMENT_KEYPAIR_PATH, 'utf8');
        const secretKey = new Uint8Array(JSON.parse(rawKey));
        cachedDevnetSettlementKeypair = Keypair.fromSecretKey(secretKey);
      }
    } catch (e: any) {
      console.warn('[DevnetSwap] Could not load settlement keypair from disk:', e.message);
    }

    if (!cachedDevnetSettlementKeypair) {
      cachedDevnetSettlementKeypair = Keypair.generate();
      try {
        const dir = path.dirname(SETTLEMENT_KEYPAIR_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          SETTLEMENT_KEYPAIR_PATH,
          JSON.stringify(Array.from(cachedDevnetSettlementKeypair.secretKey)),
          'utf8'
        );
      } catch (e: any) {
        console.warn('[DevnetSwap] Could not save settlement keypair to disk:', e.message);
      }
    }
  }

  return { keypair: cachedDevnetSettlementKeypair, isConfigured: true };
}

function getDevnetConnection(): Connection {
  const rpcUrl =
    process.env.DEVNET_RPC_URL ||
    process.env.VITE_DEVNET_RPC_URL ||
    'https://api.devnet.solana.com';
  return new Connection(rpcUrl, { commitment: 'confirmed' });
}


async function validateMint(
  connection: Connection,
  mintPk: PublicKey
): Promise<{ exists: boolean; tokenProgram: PublicKey; tokenProgramStr: string; decimals: number }> {
  const accountInfo = await connection.getAccountInfo(mintPk, 'confirmed');
  if (!accountInfo) {
    return { exists: false, tokenProgram: TOKEN_PROGRAM_ID, tokenProgramStr: TOKEN_PROGRAM_ID_STR, decimals: 6 };
  }
  const ownerStr = accountInfo.owner.toBase58();
  const isToken2022 = ownerStr === TOKEN_2022_PROGRAM_ID_STR;
  if (!isToken2022 && ownerStr !== TOKEN_PROGRAM_ID_STR) {
    throw new Error(`Unsupported Devnet mint owner: ${ownerStr}`);
  }
  const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const tokenProgramStr = isToken2022 ? TOKEN_2022_PROGRAM_ID_STR : TOKEN_PROGRAM_ID_STR;
  const parsedInfo = await connection.getParsedAccountInfo(mintPk, 'confirmed');
  const parsedData = (parsedInfo.value?.data as any)?.parsed?.info;
  const decimals = typeof parsedData?.decimals === 'number' ? parsedData.decimals : 6;
  return { exists: true, tokenProgram, tokenProgramStr, decimals };
}

async function findTokenAccount(
  connection: Connection,
  ownerPk: PublicKey,
  mintPk: PublicKey,
  tokenProgramId: PublicKey
): Promise<PublicKey | null> {
  try {
    const result = await connection.getTokenAccountsByOwner(
      ownerPk,
      { mint: mintPk, programId: tokenProgramId },
      'confirmed'
    );
    return result.value[0]?.pubkey ?? null;
  } catch {
    return null;
  }
}

async function ensureTokenAccount(
  connection: Connection,
  payerPk: PublicKey,
  ownerPk: PublicKey,
  mintPk: PublicKey,
  tokenProgramId: PublicKey,
  instructions: TransactionInstruction[]
): Promise<{ address: PublicKey; signer?: Keypair }> {
  const existing = await findTokenAccount(connection, ownerPk, mintPk, tokenProgramId);
  if (existing) return { address: existing };

  const tokenAccountKp = Keypair.generate();
  const rentLamports = await connection.getMinimumBalanceForRentExemption(AccountLayout.span);

  instructions.push(
    SystemProgram.createAccount({
      fromPubkey: payerPk,
      newAccountPubkey: tokenAccountKp.publicKey,
      lamports: rentLamports,
      space: AccountLayout.span,
      programId: tokenProgramId,
    }),
    createInitializeAccountInstruction(
      tokenAccountKp.publicKey,
      mintPk,
      ownerPk,
      tokenProgramId
    )
  );

  return { address: tokenAccountKp.publicKey, signer: tokenAccountKp };
}

function parseRawAmount(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value;
  const text = String(value ?? '');
  if (!/^\d+$/.test(text)) throw new Error(`Invalid ${field}`);
  const n = BigInt(text);
  if (n <= 0n) throw new Error(`${field} must be greater than zero`);
  return n;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEVNET_TOKEN_PRICE_SOL = Number(process.env.DEVNET_TOKEN_PRICE_SOL || '0.00001');

function calculateServerAmount(
  isBuy: boolean,
  amountRaw: bigint,
  tokenDecimals: number
): { expectedSolLamports: bigint; expectedTokenRawAmount: bigint } {
  if (!Number.isFinite(DEVNET_TOKEN_PRICE_SOL) || DEVNET_TOKEN_PRICE_SOL <= 0) {
    throw new Error('Invalid DEVNET_TOKEN_PRICE_SOL configuration');
  }

  if (isBuy) {
    const sol = Number(amountRaw) / LAMPORTS_PER_SOL;
    const tokens = sol / DEVNET_TOKEN_PRICE_SOL;
    return {
      expectedSolLamports: amountRaw,
      expectedTokenRawAmount: BigInt(Math.max(1, Math.floor(tokens * 10 ** tokenDecimals))),
    };
  }

  const tokenUnits = Number(amountRaw) / 10 ** tokenDecimals;
  const sol = tokenUnits * DEVNET_TOKEN_PRICE_SOL;
  return {
    expectedSolLamports: BigInt(Math.max(1, Math.floor(sol * LAMPORTS_PER_SOL))),
    expectedTokenRawAmount: amountRaw,
  };
}

// GET /api/devnet-swap/status
router.get('/status', async (req, res) => {
  try {
    const { keypair, isConfigured } = getSettlementKeypair();
    if (!keypair) {
      return res.json({
        buildId: BUILD_ID,
        isConfigured: false,
        settlementAddress: null,
        solBalance: 0,
        lamports: 0,
        network: 'devnet',
        status: 'unconfigured',
      });
    }

    const connection = getDevnetConnection();
    let lamports = 0;
    try {
      lamports = await connection.getBalance(keypair.publicKey, 'confirmed');
    } catch (e: any) {
      console.warn('[DevnetSwap] Failed to fetch settlement balance:', e.message);
    }

    const solBalance = lamports / LAMPORTS_PER_SOL;
    const status = !isConfigured
      ? 'unconfigured'
      : solBalance < 0.05
      ? 'needs_funding'
      : 'ready';

    return res.json({
      buildId: BUILD_ID,
      isConfigured,
      settlementAddress: keypair.publicKey.toBase58(),
      solBalance,
      lamports,
      network: 'devnet',
      status,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message, buildId: BUILD_ID });
  }
});

// GET /api/devnet-swap/shadow-mints
router.get('/shadow-mints', async (req, res) => {
  try {
    const shadowMints = await getAllShadowMints();
    return res.json({ shadowMints, buildId: BUILD_ID });
  } catch (error: any) {
    return res.status(500).json({ error: error.message, buildId: BUILD_ID });
  }
});

// GET /api/devnet-swap/diagnostic
router.get('/diagnostic', async (req, res) => {
  try {
    const { keypair, isConfigured } = getSettlementKeypair();
    const connection = getDevnetConnection();
    let lamports = 0;
    if (keypair) {
      try {
        lamports = await connection.getBalance(keypair.publicKey, 'confirmed');
      } catch {}
    }

    const solBalance = lamports / LAMPORTS_PER_SOL;
    const status = !isConfigured
      ? 'unconfigured'
      : solBalance < 0.05
      ? 'needs_funding'
      : 'ready';

    return res.json({
      buildId: BUILD_ID,
      status,
      settlementAddress: keypair ? keypair.publicKey.toBase58() : null,
      associatedTokenProgramAllowed: false,
      associatedTokenProgramId: null,
      tokenAccountCreationMethod: 'system-create-account-plus-spl-initialize-account',
      tokenTransferMethod: 'spl-token-transfer-instruction',
      isConfigured,
      solBalance,
      tokenPriceNative: DEVNET_TOKEN_PRICE_SOL,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message, buildId: BUILD_ID });
  }
});

// GET /api/devnet-swap/prices?mints=a,b,c
// Devnet-only authoritative simulation price source. This never calls mainnet price APIs.
router.get('/prices', async (req, res) => {
  try {
    const raw = String(req.query.mints || '');
    const mints = raw.split(',').map((m) => m.trim()).filter(Boolean).slice(0, 100);
    const price = DEVNET_TOKEN_PRICE_SOL;
    if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid DEVNET_TOKEN_PRICE_SOL');
    const prices: Record<string, { priceNative: number; source: string }> = {};
    for (const mint of mints) prices[mint] = { priceNative: price, source: 'devnet_server' };
    return res.json({ buildId: BUILD_ID, network: 'devnet', prices });
  } catch (error: any) {
    return res.status(500).json({ error: error.message, buildId: BUILD_ID });
  }
});

// POST /api/devnet-swap/build
router.post('/build', async (req, res) => {
  try {
    const { userPublicKey, inputMint, outputMint, amount } = req.body;
    if (!userPublicKey || !inputMint || !outputMint || amount === undefined) {
      return res.status(400).json({
        error: 'Missing required parameters: userPublicKey, inputMint, outputMint, amount',
      });
    }

    let userPk: PublicKey;
    try {
      userPk = new PublicKey(userPublicKey);
    } catch {
      return res.status(400).json({ error: 'Invalid userPublicKey' });
    }

    const { keypair: settlementKp } = getSettlementKeypair();
    if (!settlementKp) {
      return res.status(500).json({ error: 'Settlement wallet not initialized on server' });
    }
    const settlementPk = settlementKp.publicKey;
    if (settlementPk.equals(userPk)) {
      return res.status(400).json({ error: 'Devnet safety violation: user wallet and settlement wallet must be different.' });
    }
    const connection = getDevnetConnection();

    const settlementBal = await connection.getBalance(settlementPk, 'confirmed');
    if (settlementBal < 0.005 * LAMPORTS_PER_SOL) {
      return res.status(400).json({
        error: `Devnet settlement wallet (${settlementPk.toBase58()}) has insufficient Devnet SOL (${(settlementBal / LAMPORTS_PER_SOL).toFixed(4)} SOL). Fund it manually before trading.`,
      });
    }

    const isBuy = inputMint === SOL_MINT;
    const tokenMintStr = isBuy ? outputMint : inputMint;
    let tokenMintPk: PublicKey;
    try {
      tokenMintPk = new PublicKey(tokenMintStr);
    } catch {
      return res.status(400).json({ error: 'Invalid token mint address' });
    }

    let mintInfo = await validateMint(connection, tokenMintPk);
    let shadowRecord: ShadowMintRecord | null = null;
    let shadowMintKp: Keypair | undefined;
    const instructions: TransactionInstruction[] = [];

    if (!mintInfo.exists) {
      const shadowInfo = await getOrCreateShadowMintInfo(
        connection, tokenMintStr, settlementPk, settlementPk
      );
      shadowRecord = shadowInfo.record;
      shadowMintKp = shadowInfo.shadowMintKp;
      tokenMintPk = new PublicKey(shadowRecord.devnetMint);
      mintInfo = {
        exists: true,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgramStr: TOKEN_PROGRAM_ID_STR,
        decimals: shadowRecord.decimals,
      };
      instructions.push(...(shadowInfo.initInstructions || []));
    }

    const tokenDecimals = mintInfo.decimals;
    const tokenProgramId = mintInfo.tokenProgram;

    // IMPORTANT: Devnet trading never uses the Associated Token Account program.
    // Token accounts are regular SPL accounts created with SystemProgram + InitializeAccount.
    const existingUserToken = await findTokenAccount(connection, userPk, tokenMintPk, tokenProgramId);
    if (!isBuy && !existingUserToken) {
      return res.status(400).json({ error: 'SELL blocked: user has no Devnet token account for this mint.' });
    }
    const userToken = existingUserToken
      ? { address: existingUserToken }
      : await ensureTokenAccount(connection, settlementPk, userPk, tokenMintPk, tokenProgramId, instructions);
    const settlementToken = await ensureTokenAccount(
      connection, settlementPk, settlementPk, tokenMintPk, tokenProgramId, instructions
    );

    // A newly-created shadow mint gets server-controlled inventory. Existing shadow
    // mints are topped up only when their real SPL balance is low. No ATA is used.
    if (shadowRecord && tokenProgramId.equals(TOKEN_PROGRAM_ID)) {
      const parsed = await connection.getParsedAccountInfo(settlementToken.address, 'confirmed').catch(() => null);
      const currentRaw = BigInt((parsed?.value?.data as any)?.parsed?.info?.tokenAmount?.amount || '0');
      const threshold = 100_000n * (10n ** BigInt(tokenDecimals));
      if (currentRaw < threshold) {
        const topUp = 1_000_000_000n * (10n ** BigInt(tokenDecimals));
        instructions.push(
          createMintToInstruction(
            tokenMintPk, settlementToken.address, settlementPk, topUp, [], TOKEN_PROGRAM_ID
          )
        );
      }
    }

    let expectedSolLamports: bigint;
    let expectedTokenRawAmount: bigint;
    const amountRaw = parseRawAmount(amount, 'amount');

    // Client quoteResponse is intentionally ignored. Economic output is calculated on the server.
    ({ expectedSolLamports, expectedTokenRawAmount } = calculateServerAmount(
      isBuy, amountRaw, tokenDecimals
    ));

    if (isBuy) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: userPk,
          toPubkey: settlementPk,
          lamports: Number(expectedSolLamports),
        }),
        createTransferInstruction(
          settlementToken.address,
          userToken.address,
          settlementPk,
          expectedTokenRawAmount,
          [],
          tokenProgramId
        )
      );
    } else {
      instructions.push(
        createTransferInstruction(
          userToken.address,
          settlementToken.address,
          userPk,
          expectedTokenRawAmount,
          [],
          tokenProgramId
        ),
        SystemProgram.transfer({
          fromPubkey: settlementPk,
          toPubkey: userPk,
          lamports: Number(expectedSolLamports),
        })
      );
    }

    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    const messageV0 = new TransactionMessage({
      payerKey: userPk,
      recentBlockhash: latestBlockhash.blockhash,
      instructions,
    }).compileToV0Message();

    const versionedTx = new VersionedTransaction(messageV0);
    // Sign with server settlement keypair (and shadowMintKp if initializing a new shadow mint):
    const signers: Keypair[] = [settlementKp];
    if (shadowMintKp) signers.push(shadowMintKp);
    if (userToken.signer) signers.push(userToken.signer);
    if (settlementToken.signer) signers.push(settlementToken.signer);
    versionedTx.sign(signers);

    const serializedBase64 = Buffer.from(versionedTx.serialize()).toString('base64');

    return res.json({
      buildId: BUILD_ID,
      swapTransaction: serializedBase64,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      blockhash: latestBlockhash.blockhash,
      settlementPublicKey: settlementPk.toBase58(),
      userPublicKey: userPk.toBase58(),
      isBuy,
      tokenDecimals,
      expectedSolLamports: expectedSolLamports.toString(),
      expectedTokenAmount: expectedTokenRawAmount.toString(),
      userTokenAccount: userToken.address.toBase58(),
      settlementTokenAccount: settlementToken.address.toBase58(),
      shadowMint: shadowRecord
        ? {
            originalMint: shadowRecord.originalMint,
            devnetMint: shadowRecord.devnetMint,
            decimals: shadowRecord.decimals,
          }
        : null,
    });
  } catch (error: any) {
    console.error('[DevnetSwap] Build error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to build atomic devnet swap transaction',
      buildId: BUILD_ID,
    });
  }
});

export default router;

