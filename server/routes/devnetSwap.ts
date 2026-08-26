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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
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

export const BUILD_ID = 'devnet-swap-v9-reliable-tp-settlement-2026-08-26';
export const TOKEN_PROGRAM_ID_STR = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID_STR = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM_ID_STR = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

const SETTLEMENT_KEYPAIR_PATH = path.join(process.cwd(), 'data', 'devnetSettlementKeypair.json');
let ephemeralDevnetKeypair: Keypair | null = null;

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

  // Persistent fallback keypair on disk for development/testing if env var is unset
  if (!ephemeralDevnetKeypair) {
    try {
      if (fs.existsSync(SETTLEMENT_KEYPAIR_PATH)) {
        const rawKey = fs.readFileSync(SETTLEMENT_KEYPAIR_PATH, 'utf8');
        const secretKey = new Uint8Array(JSON.parse(rawKey));
        ephemeralDevnetKeypair = Keypair.fromSecretKey(secretKey);
      }
    } catch (e: any) {
      console.warn('[DevnetSwap] Could not load settlement keypair from disk:', e.message);
    }

    if (!ephemeralDevnetKeypair) {
      ephemeralDevnetKeypair = Keypair.generate();
      try {
        const dir = path.dirname(SETTLEMENT_KEYPAIR_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          SETTLEMENT_KEYPAIR_PATH,
          JSON.stringify(Array.from(ephemeralDevnetKeypair.secretKey)),
          'utf8'
        );
      } catch (e: any) {
        console.warn('[DevnetSwap] Could not save settlement keypair to disk:', e.message);
      }
    }

    console.log(
      '[DevnetSwap] Using persistent fallback settlement wallet:',
      ephemeralDevnetKeypair.publicKey.toBase58()
    );
  }
  return { keypair: ephemeralDevnetKeypair, isConfigured: false };
}

function getDevnetConnection(): Connection {
  const rpcUrl =
    process.env.DEVNET_RPC_URL ||
    process.env.VITE_DEVNET_RPC_URL ||
    'https://api.devnet.solana.com';
  return new Connection(rpcUrl, { commitment: 'confirmed' });
}

async function ensureSettlementFunded(connection: Connection, settlementPk: PublicKey): Promise<number> {
  let balance = await connection.getBalance(settlementPk, 'confirmed').catch(() => 0);
  if (balance < 0.2 * LAMPORTS_PER_SOL) {
    console.log(`[DevnetSwap] Settlement wallet balance low (${balance / LAMPORTS_PER_SOL} SOL). Requesting Devnet airdrop...`);
    try {
      const sig = await connection.requestAirdrop(settlementPk, 1 * LAMPORTS_PER_SOL);
      const latest = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
      balance = await connection.getBalance(settlementPk, 'confirmed').catch(() => 0);
      console.log(`[DevnetSwap] Airdrop successful! Settlement wallet now has ${balance / LAMPORTS_PER_SOL} SOL`);
    } catch (airdropErr: any) {
      console.warn('[DevnetSwap] Devnet airdrop notice:', airdropErr.message || airdropErr);
    }
  }
  return balance;
}

async function validateMint(
  connection: Connection,
  mintPk: PublicKey
): Promise<{ exists: boolean; tokenProgram: PublicKey; tokenProgramStr: string; decimals: number }> {
  try {
    const accountInfo = await connection.getAccountInfo(mintPk, 'confirmed');
    if (!accountInfo) {
      return {
        exists: false,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgramStr: TOKEN_PROGRAM_ID_STR,
        decimals: 6,
      };
    }
    const ownerStr = accountInfo.owner.toBase58();
    const isToken2022 = ownerStr === TOKEN_2022_PROGRAM_ID_STR;
    const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const tokenProgramStr = isToken2022 ? TOKEN_2022_PROGRAM_ID_STR : TOKEN_PROGRAM_ID_STR;

    let decimals = 6;
    try {
      const parsedInfo = await connection.getParsedAccountInfo(mintPk, 'confirmed');
      const parsedData = (parsedInfo.value?.data as any)?.parsed?.info;
      if (typeof parsedData?.decimals === 'number') {
        decimals = parsedData.decimals;
      }
    } catch {}

    return { exists: true, tokenProgram, tokenProgramStr, decimals };
  } catch {
    return {
      exists: false,
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenProgramStr: TOKEN_PROGRAM_ID_STR,
      decimals: 6,
    };
  }
}

async function ensureAta(
  connection: Connection,
  payerPk: PublicKey,
  ownerPk: PublicKey,
  mintPk: PublicKey,
  tokenProgramId: PublicKey,
  instructions: TransactionInstruction[],
  allowOwnerOffCurve = true
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(
    mintPk,
    ownerPk,
    allowOwnerOffCurve,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(ata, 'confirmed');

  if (!accountInfo) {
    // ATA does not exist on-chain: add idempotent creation instruction using detected tokenProgramId
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        payerPk,
        ata,
        ownerPk,
        mintPk,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  return ata;
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
      associatedTokenProgramAllowed: true,
      tokenAccountCreationMethod: 'associated-token-account-idempotent-instruction',
      tokenTransferMethod: 'spl-token-transfer-instruction',
      isConfigured,
      solBalance,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message, buildId: BUILD_ID });
  }
});

// POST /api/devnet-swap/build
router.post('/build', async (req, res) => {
  try {
    const { userPublicKey, inputMint, outputMint, amount, quoteResponse } = req.body;
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
    const connection = getDevnetConnection();

    // Auto-topup settlement wallet if Devnet SOL balance is low
    await ensureSettlementFunded(connection, settlementPk);

    const isBuy =
      inputMint === 'So11111111111111111111111111111111111111112' ||
      inputMint.toLowerCase().includes('sol');
    const tokenMintStr = isBuy ? outputMint : inputMint;
    let tokenMintPk: PublicKey;
    try {
      tokenMintPk = new PublicKey(tokenMintStr);
    } catch {
      return res.status(400).json({ error: 'Invalid token mint address' });
    }

    // Read real on-chain token decimals and token program ID from the mint owner.toBase58()
    let mintInfo = await validateMint(connection, tokenMintPk);
    let shadowRecord: ShadowMintRecord | null = null;
    let shadowMintKp: Keypair | undefined;

    const instructions: TransactionInstruction[] = [];

    if (!mintInfo.exists) {
      console.log(`[DevnetSwap] Token mint ${tokenMintStr} not found on Devnet. Creating/retrieving Shadow Mint...`);
      const shadowInfo = await getOrCreateShadowMintInfo(connection, tokenMintStr, settlementPk, settlementPk);
      shadowRecord = shadowInfo.record;
      shadowMintKp = shadowInfo.shadowMintKp;
      tokenMintPk = new PublicKey(shadowRecord.devnetMint);
      mintInfo = {
        exists: true,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgramStr: TOKEN_PROGRAM_ID_STR,
        decimals: shadowRecord.decimals,
      };

      if (shadowInfo.initInstructions && shadowInfo.initInstructions.length > 0) {
        instructions.push(...shadowInfo.initInstructions);
      }
    }

    const tokenDecimals = mintInfo.decimals;
    const tokenProgramId = mintInfo.tokenProgram;

    // Derive and ensure user & settlement ATAs exist (settlementPk pays rent if ATA does NOT exist on-chain)
    const userTokenAta = await ensureAta(
      connection,
      settlementPk,
      userPk,
      tokenMintPk,
      tokenProgramId,
      instructions,
      false
    );

    const settlementTokenAta = await ensureAta(
      connection,
      settlementPk,
      settlementPk,
      tokenMintPk,
      tokenProgramId,
      instructions,
      true
    );

    let expectedSolLamports = 0;
    let expectedTokenRawAmount = BigInt(0);

    if (isBuy) {
      // BUY: User gives virtual SOL -> receives on-chain Shadow Mint Token
      expectedSolLamports = Number(amount);
      if (quoteResponse && quoteResponse.outAmount) {
        expectedTokenRawAmount = BigInt(quoteResponse.outAmount);
      } else {
        const solUnits = expectedSolLamports / LAMPORTS_PER_SOL;
        const tokensCalculated = solUnits * 100000;
        expectedTokenRawAmount = BigInt(Math.floor(tokensCalculated * Math.pow(10, tokenDecimals)));
      }

      // Token Transfer: Settlement -> User
      instructions.push(
        createTransferInstruction(
          settlementTokenAta,
          userTokenAta,
          settlementPk,
          expectedTokenRawAmount,
          [],
          tokenProgramId
        )
      );
    } else {
      // SELL: User gives Token -> receives SOL
      expectedTokenRawAmount = BigInt(amount);
      if (quoteResponse && quoteResponse.outAmount) {
        expectedSolLamports = Number(quoteResponse.outAmount);
      } else {
        const tokenUnits = Number(expectedTokenRawAmount) / Math.pow(10, tokenDecimals);
        const solCalculated = tokenUnits / 100000;
        expectedSolLamports = Math.max(1000, Math.floor(solCalculated * LAMPORTS_PER_SOL));
      }

      // Auto-topup userTokenAta if on-chain balance is less than expectedTokenRawAmount
      if (shadowRecord) {
        let userOnChainTokenBal = BigInt(0);
        try {
          const balInfo = await connection.getTokenAccountBalance(userTokenAta, 'confirmed');
          if (balInfo?.value?.amount) {
            userOnChainTokenBal = BigInt(balInfo.value.amount);
          }
        } catch {}

        if (userOnChainTokenBal < expectedTokenRawAmount) {
          const missingAmount = expectedTokenRawAmount - userOnChainTokenBal;
          instructions.push(
            createMintToInstruction(
              tokenMintPk,
              userTokenAta,
              settlementPk,
              missingAmount,
              [],
              tokenProgramId
            )
          );
        }
      }

      // 1. Token Transfer: User -> Settlement
      instructions.push(
        createTransferInstruction(
          userTokenAta,
          settlementTokenAta,
          userPk,
          expectedTokenRawAmount,
          [],
          tokenProgramId
        )
      );

      // 2. SOL Transfer: Settlement -> User
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: settlementPk,
          toPubkey: userPk,
          lamports: expectedSolLamports,
        })
      );
    }

    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    const messageV0 = new TransactionMessage({
      payerKey: settlementPk,
      recentBlockhash: latestBlockhash.blockhash,
      instructions,
    }).compileToV0Message();

    const versionedTx = new VersionedTransaction(messageV0);
    // Sign with server settlement keypair (and shadowMintKp if initializing a new shadow mint):
    const signers = [settlementKp];
    if (shadowMintKp) {
      signers.push(shadowMintKp);
    }
    versionedTx.sign(signers);

    const serializedBase64 = Buffer.from(versionedTx.serialize()).toString('base64');

    return res.json({
      buildId: BUILD_ID,
      swapTransaction: serializedBase64,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      blockhash: latestBlockhash.blockhash,
      settlementPublicKey: settlementPk.toBase58(),
      isBuy,
      tokenDecimals,
      expectedSolLamports,
      expectedTokenAmount: expectedTokenRawAmount.toString(),
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

