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
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';

const router = Router();

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

  // Fallback in-memory keypair for local development/testing if unset
  if (!ephemeralDevnetKeypair) {
    ephemeralDevnetKeypair = Keypair.generate();
    console.warn(
      '[DevnetSwap] DEVNET_SETTLEMENT_PRIVATE_KEY is not set. Generated in-memory fallback settlement wallet:',
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

async function validateMint(
  connection: Connection,
  mintPk: PublicKey
): Promise<{ exists: boolean; tokenProgram: PublicKey; decimals: number }> {
  try {
    const accountInfo = await connection.getParsedAccountInfo(mintPk);
    if (!accountInfo.value) {
      return { exists: false, tokenProgram: TOKEN_PROGRAM_ID, decimals: 6 };
    }
    const isToken2022 = accountInfo.value.owner.equals(TOKEN_2022_PROGRAM_ID);
    const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const parsedData = (accountInfo.value.data as any)?.parsed?.info;
    const decimals = typeof parsedData?.decimals === 'number' ? parsedData.decimals : 6;
    return { exists: true, tokenProgram, decimals };
  } catch {
    return { exists: false, tokenProgram: TOKEN_PROGRAM_ID, decimals: 6 };
  }
}

// GET /api/devnet-swap/status
router.get('/status', async (req, res) => {
  try {
    const { keypair, isConfigured } = getSettlementKeypair();
    if (!keypair) {
      return res.json({
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
      isConfigured,
      settlementAddress: keypair.publicKey.toBase58(),
      solBalance,
      lamports,
      network: 'devnet',
      status,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
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

    // Read real on-chain token decimals and token program ID from the mint
    const mintInfo = await validateMint(connection, tokenMintPk);
    const tokenDecimals = mintInfo.decimals;
    const tokenProgramId = mintInfo.tokenProgram;

    const instructions: TransactionInstruction[] = [];

    // Derive ATAs
    const userTokenAta = getAssociatedTokenAddressSync(
      tokenMintPk,
      userPk,
      false,
      tokenProgramId
    );
    const settlementTokenAta = getAssociatedTokenAddressSync(
      tokenMintPk,
      settlementPk,
      true,
      tokenProgramId
    );

    let expectedSolLamports = 0;
    let expectedTokenRawAmount = BigInt(0);

    if (isBuy) {
      // BUY: User gives SOL -> receives Token
      expectedSolLamports = Number(amount);
      if (quoteResponse && quoteResponse.outAmount) {
        expectedTokenRawAmount = BigInt(quoteResponse.outAmount);
      } else {
        const solUnits = expectedSolLamports / LAMPORTS_PER_SOL;
        const tokensCalculated = solUnits * 100000;
        expectedTokenRawAmount = BigInt(Math.floor(tokensCalculated * Math.pow(10, tokenDecimals)));
      }

      // 1. Ensure User ATA exists
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          userPk,
          userTokenAta,
          userPk,
          tokenMintPk,
          tokenProgramId
        )
      );

      // 2. Ensure Settlement ATA exists
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          userPk,
          settlementTokenAta,
          settlementPk,
          tokenMintPk,
          tokenProgramId
        )
      );

      // 3. SOL Transfer: User -> Settlement
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: userPk,
          toPubkey: settlementPk,
          lamports: expectedSolLamports,
        })
      );

      // 4. Token Transfer: Settlement -> User
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

      // Check settlement wallet SOL balance
      const settlementBal = await connection.getBalance(settlementPk, 'confirmed').catch(() => 0);
      if (settlementBal < expectedSolLamports) {
        console.warn(
          `[DevnetSwap] Warning: Settlement wallet (${settlementPk.toBase58()}) has only ${settlementBal / LAMPORTS_PER_SOL} SOL, requested ${expectedSolLamports / LAMPORTS_PER_SOL} SOL.`
        );
      }

      // 1. Ensure User ATA exists
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          userPk,
          userTokenAta,
          userPk,
          tokenMintPk,
          tokenProgramId
        )
      );

      // 2. Ensure Settlement ATA exists
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          userPk,
          settlementTokenAta,
          settlementPk,
          tokenMintPk,
          tokenProgramId
        )
      );

      // 3. Token Transfer: User -> Settlement
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

      // 4. SOL Transfer: Settlement -> User
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
      payerKey: userPk,
      recentBlockhash: latestBlockhash.blockhash,
      instructions,
    }).compileToV0Message();

    const versionedTx = new VersionedTransaction(messageV0);
    // Sign with server settlement keypair:
    versionedTx.sign([settlementKp]);

    const serializedBase64 = Buffer.from(versionedTx.serialize()).toString('base64');

    return res.json({
      swapTransaction: serializedBase64,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      blockhash: latestBlockhash.blockhash,
      settlementPublicKey: settlementPk.toBase58(),
      isBuy,
      tokenDecimals,
      expectedSolLamports,
      expectedTokenAmount: expectedTokenRawAmount.toString(),
    });
  } catch (error: any) {
    console.error('[DevnetSwap] Build error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to build atomic devnet swap transaction',
    });
  }
});

export default router;
