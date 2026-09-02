// scripts/capture-jupiter-fixture.mjs
import fs from 'fs';
import path from 'path';
import { Connection } from '@solana/web3.js';

const args = process.argv.slice(2);
const signature = args[0];
const userWallet = args[1];
const quotePath = args[2];

if (!signature || !userWallet) {
  console.error('❌ Usage: npm run capture:jupiter -- <SIGNATURE> <USER_WALLET> [QUOTE_JSON_PATH]');
  process.exit(1);
}

const rpcUrl = process.env.VITE_SOLANA_RPC_URL || process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');

async function run() {
  console.log(`🔍 [Capture] Fetching confirmed transaction: ${signature}...`);
  console.log(`👤 User Wallet: ${userWallet}`);

  let originalQuote = null;
  if (quotePath) {
    try {
      const resolved = path.resolve(process.cwd(), quotePath);
      if (fs.existsSync(resolved)) {
        originalQuote = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
        console.log(`📄 Loaded original Jupiter quote snapshot from: ${quotePath}`);
      }
    } catch (e) {
      console.warn(`⚠️ Warning: Failed to parse quote snapshot at ${quotePath}: ${e.message}`);
    }
  }

  const txDetails = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });

  if (!txDetails || !txDetails.meta) {
    console.error(`❌ Transaction not found or missing metadata for signature: ${signature}`);
    process.exit(1);
  }

  const accountKeys = txDetails.transaction.message.accountKeys.map((k) =>
    typeof k === 'string' ? k : (k?.pubkey?.toBase58 ? k.pubkey.toBase58() : String(k?.pubkey || ''))
  );
  const logs = txDetails.meta.logMessages || [];
  const JUPITER_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74bheuvzS44Ff2qG31941';
  const JUPITER_V4_PROGRAM_ID = 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB';

  const hasJupiterProgram = accountKeys.some((k) => k === JUPITER_PROGRAM_ID || k === JUPITER_V4_PROGRAM_ID);
  const logsContainJupiter = logs.some((l) => l.toLowerCase().includes('jup') || l.includes(JUPITER_PROGRAM_ID));

  let inputMint = 'So11111111111111111111111111111111111111112';
  let outputMint = 'So11111111111111111111111111111111111111112';
  let isSolBuy = true;

  const userPreTokens = (txDetails.meta.preTokenBalances || []).filter((b) => b.owner === userWallet);
  const userPostTokens = (txDetails.meta.postTokenBalances || []).filter((b) => b.owner === userWallet);

  const tokenMints = new Set();
  userPreTokens.forEach((b) => b.mint && tokenMints.add(b.mint));
  userPostTokens.forEach((b) => b.mint && tokenMints.add(b.mint));

  let detectedSplMint = '';
  for (const mint of tokenMints) {
    if (mint !== 'So11111111111111111111111111111111111111112') {
      detectedSplMint = mint;
      break;
    }
  }

  if (originalQuote) {
    inputMint = originalQuote.inputMint;
    outputMint = originalQuote.outputMint;
    isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';
  } else if (detectedSplMint) {
    const preTok = userPreTokens.find((b) => b.mint === detectedSplMint);
    const postTok = userPostTokens.find((b) => b.mint === detectedSplMint);
    const preAmt = preTok?.uiTokenAmount?.amount ? BigInt(preTok.uiTokenAmount.amount) : 0n;
    const postAmt = postTok?.uiTokenAmount?.amount ? BigInt(postTok.uiTokenAmount.amount) : 0n;

    if (postAmt > preAmt) {
      inputMint = 'So11111111111111111111111111111111111111112';
      outputMint = detectedSplMint;
      isSolBuy = true;
    } else {
      inputMint = detectedSplMint;
      outputMint = 'So11111111111111111111111111111111111111112';
      isSolBuy = false;
    }
  }

  const fixture = {
    signature,
    userWallet,
    slot: txDetails.slot,
    blockTime: txDetails.blockTime || null,
    inputMint,
    outputMint,
    isSolBuy,
    actualFeeSol: (txDetails.meta.fee || 5000) / 1e9,
    transactionMeta: {
      err: txDetails.meta.err,
      fee: txDetails.meta.fee,
      logMessages: txDetails.meta.logMessages,
      preBalances: txDetails.meta.preBalances,
      postBalances: txDetails.meta.postBalances,
      preTokenBalances: txDetails.meta.preTokenBalances,
      postTokenBalances: txDetails.meta.postTokenBalances,
    },
    detectedJupiterEvidence: {
      hasJupiterProgram,
      programIds: accountKeys.filter((k) => k.startsWith('JUP') || k.toLowerCase().includes('jup')),
      logsContainJupiter,
    },
    originalQuoteSnapshot: originalQuote || null,
    capturedAt: new Date().toISOString(),
  };

  const outputDir = path.resolve(process.cwd(), 'fixtures/jupiter');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fixturePath = path.join(outputDir, `${signature}.json`);
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), 'utf-8');

  console.log(`✅ [Capture] Successfully saved transaction fixture to:\n   ${fixturePath}`);
}

run().catch((err) => {
  console.error('❌ Capture failed:', err.message);
  process.exit(1);
});
