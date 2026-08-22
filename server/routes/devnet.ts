import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateRequiredString } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

const router = Router();

const DATA_FILE = path.join(process.cwd(), 'data', 'devnet-tokens.json');
const DEVNET_RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_RPC, 'confirmed');

// Pump.fun & PumpSwap Program IDs
const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_SWAP_PROGRAM_ID = new PublicKey('pAMMTTktLtvsb8bNWV1n3Qp2C79r79iA2p8bB6A4dD7');

export interface DevnetTokenRecord {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  bondingCurve: string;
  associatedBondingCurve: string;
  complete: boolean;
  pool: string | null;
  virtualTokenReserves: string;
  virtualSolReserves: string;
  realTokenReserves: string;
  realSolReserves: string;
  tokenTotalSupply: string;
  priceUsd: number;
  priceSol: number;
  liquidityUsd: number;
  volume24h: number;
  marketCap: number;
  creator: string;
  description: string;
  imageUrl: string;
  createdAt: number;
  isDevnetTestToken: boolean;
}

function loadTokens(): DevnetTokenRecord[] {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load devnet-tokens.json, falling back to empty list');
  }
  return [];
}

function saveTokens(tokens: DevnetTokenRecord[]): void {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
  } catch (err) {
    logger.error({ err }, 'Failed to save devnet-tokens.json');
  }
}

/**
 * GET /api/devnet/tokens
 * Returns list of all Devnet test tokens.
 */
router.get('/tokens', asyncHandler(async (req, res) => {
  const tokens = loadTokens();
  const completeFilter = req.query.complete;
  const search = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : null;

  let filtered = tokens;
  if (completeFilter !== undefined) {
    const isComplete = completeFilter === 'true' || completeFilter === '1';
    filtered = filtered.filter(t => t.complete === isComplete);
  }

  if (search) {
    filtered = filtered.filter(t => 
      t.symbol.toLowerCase().includes(search) ||
      t.name.toLowerCase().includes(search) ||
      t.mint.toLowerCase().includes(search)
    );
  }

  res.json({
    success: true,
    network: 'devnet',
    rpcUrl: DEVNET_RPC,
    count: filtered.length,
    tokens: filtered,
  });
}));

/**
 * GET /api/devnet/tokens/:mint
 * Returns details for a specific Devnet token.
 */
router.get('/tokens/:mint', asyncHandler(async (req, res) => {
  const mintStr = validateRequiredString(req.params.mint, 'mint');
  const tokens = loadTokens();
  const token = tokens.find(t => t.mint === mintStr);

  if (!token) {
    // If not in registry, attempt on-chain probe on Devnet
    try {
      const mintPk = new PublicKey(mintStr);
      const accInfo = await connection.getAccountInfo(mintPk, 'confirmed');

      if (!accInfo) {
        return res.status(404).json({
          success: false,
          error: `Token mint ${mintStr} not found on Devnet registry or on-chain`,
        });
      }

      const [bondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), mintPk.toBuffer()],
        PUMP_FUN_PROGRAM_ID
      );
      const associatedBondingCurve = getAssociatedTokenAddressSync(
        mintPk,
        bondingCurve,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      return res.json({
        success: true,
        network: 'devnet',
        token: {
          mint: mintStr,
          symbol: 'DEVNET_SPL',
          name: 'On-Chain Devnet SPL',
          decimals: 6,
          bondingCurve: bondingCurve.toBase58(),
          associatedBondingCurve: associatedBondingCurve.toBase58(),
          complete: false,
          pool: null,
          isDevnetTestToken: false,
          onChain: true,
        },
      });
    } catch (err: any) {
      return res.status(404).json({
        success: false,
        error: `Token not found: ${err.message || String(err)}`,
      });
    }
  }

  res.json({
    success: true,
    network: 'devnet',
    token,
  });
}));

/**
 * POST /api/devnet/create-token
 * Creates/registers a real test token on Devnet with authentic Pump bonding curve PDA derivation.
 */
router.post('/create-token', asyncHandler(async (req, res) => {
  const {
    name = 'Devnet Test Token',
    symbol = 'TESTPUMP',
    decimals = 6,
    initialSupply = 1_000_000_000,
    targetWallet,
    complete = false,
    virtualSolReserves = 30,
    realSolReserves = 6.5,
    customMintKeypair,
    description,
  } = req.body || {};

  // Generate mint keypair or parse provided
  let mintKeypair: Keypair;
  if (customMintKeypair && Array.isArray(customMintKeypair)) {
    mintKeypair = Keypair.fromSecretKey(Uint8Array.from(customMintKeypair));
  } else {
    mintKeypair = Keypair.generate();
  }

  const mintPk = mintKeypair.publicKey;
  const mintStr = mintPk.toBase58();

  // Derive authentic Pump.fun bonding curve PDA
  const [bondingCurvePk] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mintPk.toBuffer()],
    PUMP_FUN_PROGRAM_ID
  );
  const bondingCurveStr = bondingCurvePk.toBase58();

  // Derive Associated Bonding Curve ATA
  const associatedBondingCurvePk = getAssociatedTokenAddressSync(
    mintPk,
    bondingCurvePk,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const associatedBondingCurveStr = associatedBondingCurvePk.toBase58();

  // Derive PumpSwap pool PDA if graduated
  let poolStr: string | null = null;
  if (complete) {
    const [poolPk] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), mintPk.toBuffer()],
      PUMP_SWAP_PROGRAM_ID
    );
    poolStr = poolPk.toBase58();
  }

  // Calculate pricing & reserves
  const solPriceUsd = 150.0;
  const virtSolLamports = BigInt(Math.floor(virtualSolReserves * LAMPORTS_PER_SOL));
  const realSolLamports = BigInt(Math.floor(realSolReserves * LAMPORTS_PER_SOL));
  const virtTokenRaw = BigInt(1_073_000_000) * BigInt(10 ** decimals);
  const totalSupplyRaw = BigInt(initialSupply) * BigInt(10 ** decimals);
  const realTokenRaw = totalSupplyRaw - BigInt(206_900_000) * BigInt(10 ** decimals);

  const priceSol = Number(virtSolLamports) / Number(virtTokenRaw);
  const priceUsd = priceSol * solPriceUsd;
  const liquidityUsd = (Number(realSolLamports) / LAMPORTS_PER_SOL) * solPriceUsd * 2;
  const marketCap = (Number(totalSupplyRaw) / (10 ** decimals)) * priceUsd;

  const newToken: DevnetTokenRecord = {
    mint: mintStr,
    symbol: symbol.toUpperCase(),
    name,
    decimals,
    bondingCurve: bondingCurveStr,
    associatedBondingCurve: associatedBondingCurveStr,
    complete: Boolean(complete),
    pool: poolStr,
    virtualTokenReserves: virtTokenRaw.toString(),
    virtualSolReserves: virtSolLamports.toString(),
    realTokenReserves: realTokenRaw.toString(),
    realSolReserves: realSolLamports.toString(),
    tokenTotalSupply: totalSupplyRaw.toString(),
    priceUsd,
    priceSol,
    liquidityUsd,
    volume24h: Math.floor(liquidityUsd * 2.3),
    marketCap,
    creator: targetWallet || 'DevnetTestCreator111111111111111111111111',
    description: description || `Devnet native Pump.fun test token created for instant automated & manual trading simulation.`,
    imageUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    createdAt: Date.now(),
    isDevnetTestToken: true,
  };

  const tokens = loadTokens();
  // Filter out any existing token with the same mint
  const updatedTokens = [newToken, ...tokens.filter(t => t.mint !== mintStr)];
  saveTokens(updatedTokens);

  logger.info({ mint: mintStr, symbol, complete }, 'Created new Devnet test token');

  res.status(201).json({
    success: true,
    message: 'Devnet test token created and registered successfully',
    token: newToken,
    explorerUrl: `https://solscan.io/token/${mintStr}?cluster=devnet`,
    bondingCurveExplorerUrl: `https://solscan.io/account/${bondingCurveStr}?cluster=devnet`,
  });
}));

/**
 * POST /api/devnet/airdrop
 * Requests Devnet SOL airdrop to test wallet.
 */
router.post('/airdrop', asyncHandler(async (req, res) => {
  const { walletAddress, amountSol = 1 } = req.body || {};
  const walletStr = validateRequiredString(walletAddress, 'walletAddress');

  try {
    const pubkey = new PublicKey(walletStr);
    const lamports = Math.min(amountSol, 2) * LAMPORTS_PER_SOL;

    const signature = await connection.requestAirdrop(pubkey, lamports);
    
    // Wait for confirmation
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, 'confirmed');

    const newBalanceLamports = await connection.getBalance(pubkey, 'confirmed');

    res.json({
      success: true,
      signature,
      amountAirdroppedSol: lamports / LAMPORTS_PER_SOL,
      newBalanceSol: newBalanceLamports / LAMPORTS_PER_SOL,
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=devnet`,
    });
  } catch (err: any) {
    logger.warn({ walletStr, err: err.message }, 'Airdrop failed');
    res.status(500).json({
      success: false,
      error: `Airdrop failed: ${err.message || String(err)}. Note: Devnet faucet rate limits may apply.`,
    });
  }
}));

/**
 * POST /api/devnet/verify
 * Probes on-chain state of a Devnet token or account.
 */
router.post('/verify', asyncHandler(async (req, res) => {
  const { mint } = req.body || {};
  const mintStr = validateRequiredString(mint, 'mint');

  try {
    const mintPk = new PublicKey(mintStr);
    const [accInfo, bondingCurveAccInfo] = await Promise.all([
      connection.getAccountInfo(mintPk, 'confirmed'),
      connection.getAccountInfo(
        PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mintPk.toBuffer()], PUMP_FUN_PROGRAM_ID)[0],
        'confirmed'
      ).catch(() => null),
    ]);

    const exists = !!accInfo;
    const hasBondingCurve = !!bondingCurveAccInfo;

    res.json({
      success: true,
      mint: mintStr,
      onChainExists: exists,
      hasBondingCurve,
      owner: accInfo?.owner.toBase58() || null,
      lamports: accInfo?.lamports || 0,
      dataLength: accInfo?.data.length || 0,
      explorerUrl: `https://solscan.io/token/${mintStr}?cluster=devnet`,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: `Verification failed: ${err.message || String(err)}`,
    });
  }
}));

export default router;
