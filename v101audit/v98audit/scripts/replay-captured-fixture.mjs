// scripts/replay-captured-fixture.mjs
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const fixtureFile = args[0];

if (!fixtureFile) {
  console.error('❌ Usage: npm run replay:captured -- fixtures/jupiter/<SIGNATURE>.json');
  process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), fixtureFile);
if (!fs.existsSync(resolvedPath)) {
  console.error(`❌ Fixture file not found: ${resolvedPath}`);
  process.exit(1);
}

const fixture = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));

console.log(`▶ [Replay] Replaying captured Jupiter transaction fixture: ${fixture.signature}`);
console.log(`  Wallet: ${fixture.userWallet}`);
console.log(`  Slot: ${fixture.slot}`);
console.log(`  Swap Direction: ${fixture.isSolBuy ? 'SOL -> Token (BUY)' : 'Token -> SOL (SELL)'}`);

// Replay verification logic
function replayFixture(fix) {
  if (!fix.originalQuoteSnapshot) {
    throw new Error(
      `HISTORICAL_TRANSACTION_REJECTED: Historical captured fixture (${fix.signature.slice(0, 8)}...) does not have an original quote snapshot. Threshold replay is explicitly rejected instead of inventing one.`
    );
  }

  const meta = fix.transactionMeta;
  if (meta.err) {
    throw new Error(`Mainnet transaction on-chain execution failed: ${JSON.stringify(meta.err)}`);
  }

  const actualFeeSol = (meta.fee || 5000) / 1e9;
  let actualOutputAmount = 0;
  let verified = false;

  if (fix.isSolBuy) {
    if (meta.preTokenBalances && meta.postTokenBalances) {
      const preTok = meta.preTokenBalances.find((b) => b.mint === fix.outputMint && b.owner === fix.userWallet);
      const postTok = meta.postTokenBalances.find((b) => b.mint === fix.outputMint && b.owner === fix.userWallet);
      const preAmt = preTok?.uiTokenAmount?.amount ? BigInt(preTok.uiTokenAmount.amount) : 0n;
      const postAmt = postTok?.uiTokenAmount?.amount ? BigInt(postTok.uiTokenAmount.amount) : 0n;
      const delta = postAmt - preAmt;
      if (delta > 0n) {
        actualOutputAmount = Number(delta);
        verified = true;
      }
    }
  } else {
    // Token -> SOL
    if (meta.preBalances && meta.postBalances) {
      const userIdx = 0; // User is index 0 in captured message
      const preBal = meta.preBalances[userIdx];
      const postBal = meta.postBalances[userIdx];
      const feeLamports = meta.fee || 0;
      const grossLamports = postBal - preBal + feeLamports;
      if (grossLamports > 0) {
        actualOutputAmount = grossLamports;
        verified = true;
      }
    }
  }

  if (!verified || actualOutputAmount <= 0) {
    throw new Error('CONFIRMED_RECEIPT_UNVERIFIED: Could not verify positive on-chain balance delta from transaction receipt.');
  }

  const quote = fix.originalQuoteSnapshot;
  const otherAmountThreshold = quote.otherAmountThreshold ? Number(quote.otherAmountThreshold) : 0;

  if (otherAmountThreshold > 0 && actualOutputAmount < otherAmountThreshold) {
    throw new Error(
      `SLIPPAGE_TOLERANCE_EXCEEDED: Actual confirmed output amount (${actualOutputAmount}) was below original quote threshold (${otherAmountThreshold}).`
    );
  }

  return {
    verified: true,
    actualFeeSol,
    actualOutputAmount,
    otherAmountThreshold,
  };
}

try {
  const result = replayFixture(fixture);
  console.log('\n✅ [Replay Success] Transaction confirmed and verified against original quote threshold:');
  console.log(`   - Verified On-Chain Delta: ${result.actualOutputAmount} base units`);
  console.log(`   - Slippage Threshold (otherAmountThreshold): ${result.otherAmountThreshold}`);
  console.log(`   - Network Fee: ${result.actualFeeSol} SOL`);
} catch (err) {
  console.error(`\n❌ [Replay Rejection] ${err.message}`);
  process.exit(1);
}
