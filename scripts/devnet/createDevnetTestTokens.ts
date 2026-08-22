// scripts/devnet/createDevnetTestTokens.ts
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

const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_SWAP_PROGRAM_ID = new PublicKey('pAMMTTktLtvsb8bNWV1n3Qp2C79r79iA2p8bB6A4dD7');
const DEVNET_RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const DATA_FILE = path.join(process.cwd(), 'data', 'devnet-tokens.json');

async function main() {
  console.log('🚀 Creating Devnet-native Pump.fun test tokens...');
  console.log(`📡 Connecting to Devnet RPC: ${DEVNET_RPC}`);

  const sampleTokens = [
    {
      name: 'Pump Nitro Devnet',
      symbol: 'NITRO',
      decimals: 6,
      initialSupply: 1_000_000_000,
      complete: false,
      virtualSol: 30,
      realSol: 4.8,
      description: 'High velocity experimental memecoin on Solana Devnet bonding curve.',
    },
    {
      name: 'Devnet Cat VIP',
      symbol: 'DEVCAT',
      decimals: 6,
      initialSupply: 1_000_000_000,
      complete: false,
      virtualSol: 30,
      realSol: 14.2,
      description: 'Active Devnet cat meme with rising bonding curve progress.',
    },
    {
      name: 'Graduated Swap Alpha',
      symbol: 'SWAPALP',
      decimals: 6,
      initialSupply: 1_000_000_000,
      complete: true,
      virtualSol: 0,
      realSol: 85.0,
      description: 'Graduated token traded via PumpSwap AMM / Raydium pool.',
    },
  ];

  let existingTokens: any[] = [];
  try {
    if (fs.existsSync(DATA_FILE)) {
      existingTokens = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch {}

  const createdTokens = [];

  for (const item of sampleTokens) {
    const mintKeypair = Keypair.generate();
    const mintPk = mintKeypair.publicKey;
    const mintStr = mintPk.toBase58();

    const [bondingCurvePk] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintPk.toBuffer()],
      PUMP_FUN_PROGRAM_ID
    );

    const associatedBondingCurvePk = getAssociatedTokenAddressSync(
      mintPk,
      bondingCurvePk,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    let poolStr: string | null = null;
    if (item.complete) {
      const [poolPk] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool'), mintPk.toBuffer()],
        PUMP_SWAP_PROGRAM_ID
      );
      poolStr = poolPk.toBase58();
    }

    const solPriceUsd = 150.0;
    const virtSolLamports = BigInt(Math.floor(item.virtualSol * LAMPORTS_PER_SOL));
    const realSolLamports = BigInt(Math.floor(item.realSol * LAMPORTS_PER_SOL));
    const virtTokenRaw = BigInt(1_073_000_000) * BigInt(10 ** item.decimals);
    const totalSupplyRaw = BigInt(item.initialSupply) * BigInt(10 ** item.decimals);
    const realTokenRaw = totalSupplyRaw - BigInt(206_900_000) * BigInt(10 ** item.decimals);

    const priceSol = item.complete ? 0.00000085 : Number(virtSolLamports) / Number(virtTokenRaw);
    const priceUsd = priceSol * solPriceUsd;
    const liquidityUsd = (Number(realSolLamports) / LAMPORTS_PER_SOL) * solPriceUsd * 2;
    const marketCap = (Number(totalSupplyRaw) / (10 ** item.decimals)) * priceUsd;

    const tokenObj = {
      mint: mintStr,
      symbol: item.symbol,
      name: item.name,
      decimals: item.decimals,
      bondingCurve: bondingCurvePk.toBase58(),
      associatedBondingCurve: associatedBondingCurvePk.toBase58(),
      complete: item.complete,
      pool: poolStr,
      virtualTokenReserves: virtTokenRaw.toString(),
      virtualSolReserves: virtSolLamports.toString(),
      realTokenReserves: realTokenRaw.toString(),
      realSolReserves: realSolLamports.toString(),
      tokenTotalSupply: totalSupplyRaw.toString(),
      priceUsd,
      priceSol,
      liquidityUsd,
      volume24h: Math.floor(liquidityUsd * 1.8),
      marketCap,
      creator: 'DevnetGenerator111111111111111111111111111',
      description: item.description,
      imageUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
      createdAt: Date.now(),
      isDevnetTestToken: true,
    };

    createdTokens.push(tokenObj);
    console.log(`✅ Generated ${tokenObj.symbol} (${tokenObj.name}) -> Mint: ${tokenObj.mint}`);
    console.log(`   Bonding Curve PDA: ${tokenObj.bondingCurve}`);
    console.log(`   Route: ${tokenObj.complete ? 'PumpSwap AMM (' + tokenObj.pool + ')' : 'Pump.fun Bonding Curve'}`);
  }

  const merged = [...createdTokens, ...existingTokens.filter(e => !createdTokens.some(c => c.mint === e.mint))];
  fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  console.log(`\n🎉 Successfully saved ${merged.length} Devnet test tokens to ${DATA_FILE}`);
}

main().catch(err => {
  console.error('Fatal error generating Devnet tokens:', err);
  process.exit(1);
});
