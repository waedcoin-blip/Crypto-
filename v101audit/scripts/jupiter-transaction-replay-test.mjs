// scripts/jupiter-transaction-replay-test.mjs
import assert from 'assert';

console.log('🚀 Starting Jupiter Transaction Replay & Failure Classification Test Suite...\n');

// 1. Standalone Replay Logic Testing
function classifyExecutionError(err) {
  const msg = (err?.message || String(err)).toLowerCase();
  if (
    msg.includes('slippage') ||
    msg.includes('excessive_slippage') ||
    msg.includes('price impact') ||
    msg.includes('otheramountthreshold') ||
    msg.includes('tolerance_exceeded')
  ) {
    return 'slippage_failure';
  }
  if (
    msg.includes('receipt') ||
    msg.includes('txdetails') ||
    msg.includes('balance delta') ||
    msg.includes('receipt_failure') ||
    msg.includes('failed to parse transaction') ||
    msg.includes('confirmed_receipt_unverified')
  ) {
    return 'receipt_failure';
  }
  if (
    msg.includes('quote') ||
    msg.includes('route') ||
    msg.includes('no executable routes') ||
    msg.includes('quote_safety') ||
    msg.includes('stale') ||
    msg.includes('empty quote')
  ) {
    return 'quote_failure';
  }
  return 'transaction_failure';
}

function validateInitialQuote({ quote, inputAmount, slippageBps, maxPriceImpactPct = 10.0 }) {
  if (inputAmount <= 0 || !Number.isFinite(inputAmount)) {
    const err = new Error(`INVALID_SWAP_AMOUNT: Amount must be positive and finite (got: ${inputAmount})`);
    err.classification = 'quote_failure';
    throw err;
  }
  if (slippageBps > 1000) {
    const err = new Error(`EXCESSIVE_SLIPPAGE: Slippage BPS ${slippageBps} exceeds maximum allowable limit of 1000 (10%).`);
    err.classification = 'slippage_failure';
    throw err;
  }
  if (!quote) {
    const err = new Error('QUOTE_SAFETY_ERROR: Jupiter returned empty quote.');
    err.classification = 'quote_failure';
    throw err;
  }
  if (!quote.outAmount || BigInt(quote.outAmount) <= 0n) {
    const err = new Error('QUOTE_SAFETY_ERROR: Jupiter returned zero or negative output amount.');
    err.classification = 'quote_failure';
    throw err;
  }
  if (!quote.routePlan || quote.routePlan.length === 0) {
    const err = new Error('QUOTE_SAFETY_ERROR: Jupiter returned no executable routes.');
    err.classification = 'quote_failure';
    throw err;
  }
  const impact = parseFloat(String(quote.priceImpactPct || '0')) * 100;
  if (impact > maxPriceImpactPct) {
    const err = new Error(`QUOTE_SAFETY_ERROR: Excessive price impact (${impact.toFixed(2)}%) exceeds safety threshold of ${maxPriceImpactPct.toFixed(1)}%.`);
    err.classification = 'slippage_failure';
    throw err;
  }
  return {
    otherAmountThreshold: quote.otherAmountThreshold ? Number(quote.otherAmountThreshold) : 0,
    outAmount: Number(quote.outAmount),
  };
}

function validateExecutionReQuote({ initialQuote, freshQuote, slippageBps }) {
  if (!freshQuote || !freshQuote.outAmount) {
    const err = new Error('Jupiter execution-time re-quote is missing or empty.');
    err.classification = 'quote_failure';
    throw err;
  }
  const initialThreshold = initialQuote.otherAmountThreshold ? Number(initialQuote.otherAmountThreshold) : 0;
  const freshOutAmount = Number(freshQuote.outAmount);

  if (freshOutAmount <= 0) {
    const err = new Error('Execution-time re-quote returned non-positive output amount.');
    err.classification = 'quote_failure';
    throw err;
  }
  if (initialThreshold > 0 && freshOutAmount < initialThreshold) {
    const err = new Error(`SLIPPAGE_TOLERANCE_EXCEEDED: Execution output amount (${freshOutAmount}) fell below minimum required threshold (${initialThreshold}).`);
    err.classification = 'slippage_failure';
    throw err;
  }
  return { executableOutAmount: freshOutAmount };
}

function verifyConfirmedReceipt({ txDetails, userPublicKey, inputMint, outputMint, isSolBuy }) {
  if (!txDetails || !txDetails.meta) {
    const err = new Error('Transaction details or metadata are missing.');
    err.classification = 'receipt_failure';
    throw err;
  }
  if (txDetails.meta.err) {
    const err = new Error(`Mainnet transaction on-chain execution failed: ${JSON.stringify(txDetails.meta.err)}`);
    err.classification = 'transaction_failure';
    throw err;
  }

  const actualFeeSol = (txDetails.meta.fee || 5000) / 1e9;
  let actualOutputAmount = 0;
  let verified = false;

  if (isSolBuy) {
    if (txDetails.meta.preTokenBalances && txDetails.meta.postTokenBalances) {
      const preTok = txDetails.meta.preTokenBalances.find(b => b.mint === outputMint && b.owner === userPublicKey);
      const postTok = txDetails.meta.postTokenBalances.find(b => b.mint === outputMint && b.owner === userPublicKey);
      const preAmount = preTok?.uiTokenAmount?.amount ? BigInt(preTok.uiTokenAmount.amount) : 0n;
      const postAmount = postTok?.uiTokenAmount?.amount ? BigInt(postTok.uiTokenAmount.amount) : 0n;
      const delta = postAmount - preAmount;
      if (delta > 0n) {
        actualOutputAmount = Number(delta);
        verified = true;
      }
    }
  } else {
    if (txDetails.meta.preBalances && txDetails.meta.postBalances && txDetails.transaction?.message?.accountKeys) {
      const keys = txDetails.transaction.message.accountKeys;
      const userIdx = keys.findIndex(k => {
        const pk = typeof k === 'string' ? k : (k?.pubkey?.toBase58 ? k.pubkey.toBase58() : String(k?.pubkey || ''));
        return pk === userPublicKey;
      });
      if (userIdx !== -1 && txDetails.meta.preBalances[userIdx] !== undefined && txDetails.meta.postBalances[userIdx] !== undefined) {
        const preBal = txDetails.meta.preBalances[userIdx];
        const postBal = txDetails.meta.postBalances[userIdx];
        const feeLamports = userIdx === 0 && txDetails.meta.fee ? txDetails.meta.fee : 0;
        const grossLamports = postBal - preBal + feeLamports;
        if (grossLamports > 0) {
          actualOutputAmount = grossLamports;
          verified = true;
        }
      }
    }
  }

  if (!verified || actualOutputAmount <= 0) {
    const err = new Error('CONFIRMED_RECEIPT_UNVERIFIED: Could not verify positive on-chain balance delta from transaction receipt. Refusing to use unverified quote proceeds.');
    err.classification = 'receipt_failure';
    throw err;
  }

  return {
    verified: true,
    actualFeeSol,
    actualOutputAmount,
    slot: txDetails.slot || 100,
  };
}

// ==================== TEST 1: Initial Quote Replay & Threshold Extraction ====================
console.log('▶ [TEST 1] Initial Jupiter quote replay & otherAmountThreshold extraction');
const validQuote = {
  inAmount: '100000000',
  outAmount: '500000000',
  otherAmountThreshold: '495000000',
  priceImpactPct: '0.01',
  routePlan: [{ swapInfo: { ammKey: 'test_amm' } }],
};
const res1 = validateInitialQuote({ quote: validQuote, inputAmount: 100000000, slippageBps: 100 });
assert.strictEqual(res1.outAmount, 500000000);
assert.strictEqual(res1.otherAmountThreshold, 495000000);
console.log('  ✔ Initial quote valid, threshold correctly extracted: 495000000');

// ==================== TEST 2: Missing/Stale/Invalid Route Rejections ====================
console.log('▶ [TEST 2] Missing/stale quote and invalid route rejections (quote_failure)');
try {
  validateInitialQuote({ quote: null, inputAmount: 100000000, slippageBps: 100 });
  assert.fail('Should have thrown');
} catch (err) {
  assert.strictEqual(classifyExecutionError(err), 'quote_failure');
}

try {
  validateInitialQuote({ quote: { ...validQuote, routePlan: [] }, inputAmount: 100000000, slippageBps: 100 });
  assert.fail('Should have thrown');
} catch (err) {
  assert.strictEqual(classifyExecutionError(err), 'quote_failure');
}
console.log('  ✔ Missing quote and empty route plan properly classified as quote_failure');

// ==================== TEST 3: Excessive Slippage & Price Impact Rejection ====================
console.log('▶ [TEST 3] Excessive slippage & price impact rejections (slippage_failure)');
try {
  validateInitialQuote({ quote: validQuote, inputAmount: 100000000, slippageBps: 1200 });
  assert.fail('Should have thrown');
} catch (err) {
  assert.strictEqual(classifyExecutionError(err), 'slippage_failure');
}

try {
  validateInitialQuote({ quote: { ...validQuote, priceImpactPct: '0.12' }, inputAmount: 100000000, slippageBps: 100 });
  assert.fail('Should have thrown');
} catch (err) {
  assert.strictEqual(classifyExecutionError(err), 'slippage_failure');
}
console.log('  ✔ Excessive slippage (>10%) & price impact (>10%) properly classified as slippage_failure');

// ==================== TEST 4: Execution-time Re-quote and otherAmountThreshold Enforcement ====================
console.log('▶ [TEST 4] Execution-time re-quote behavior & slippage failure replay');
const freshQuotePass = { outAmount: '496000000' };
const res4 = validateExecutionReQuote({ initialQuote: validQuote, freshQuote: freshQuotePass, slippageBps: 100 });
assert.strictEqual(res4.executableOutAmount, 496000000);

const freshQuoteFail = { outAmount: '490000000' }; // Below 495000000 threshold
try {
  validateExecutionReQuote({ initialQuote: validQuote, freshQuote: freshQuoteFail, slippageBps: 100 });
  assert.fail('Should have thrown');
} catch (err) {
  assert.strictEqual(classifyExecutionError(err), 'slippage_failure');
  assert.match(err.message, /SLIPPAGE_TOLERANCE_EXCEEDED/);
}
console.log('  ✔ otherAmountThreshold enforcement prevented execution and triggered slippage_failure');

// ==================== TEST 5: Mainnet Confirmation Failure Replay ====================
console.log('▶ [TEST 5] Mainnet confirmation failure replay (transaction_failure)');
const failedTxDetails = {
  meta: {
    err: { InstructionError: [0, 'Custom(1)'] },
    fee: 5000,
  },
  slot: 12345,
};
try {
  verifyConfirmedReceipt({
    txDetails: failedTxDetails,
    userPublicKey: 'UserWallet111111111111111111111111111111111',
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'TokenMint1111111111111111111111111111111111',
    isSolBuy: true,
  });
  assert.fail('Should have thrown');
} catch (err) {
  assert.strictEqual(classifyExecutionError(err), 'transaction_failure');
}
console.log('  ✔ On-chain execution failure properly classified as transaction_failure');

// ==================== TEST 6: Confirmed Receipt Verification (BUY) ====================
console.log('▶ [TEST 6] Confirmed receipt verification & token balance delta (BUY)');
const userPk = 'UserWallet111111111111111111111111111111111';
const tokenMint = 'TokenMint1111111111111111111111111111111111';
const successfulBuyTxDetails = {
  slot: 290192,
  meta: {
    err: null,
    fee: 10000,
    preTokenBalances: [
      { mint: tokenMint, owner: userPk, uiTokenAmount: { amount: '1000000' } }
    ],
    postTokenBalances: [
      { mint: tokenMint, owner: userPk, uiTokenAmount: { amount: '6000000' } }
    ],
  },
};
const receiptBuy = verifyConfirmedReceipt({
  txDetails: successfulBuyTxDetails,
  userPublicKey: userPk,
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: tokenMint,
  isSolBuy: true,
});
assert.strictEqual(receiptBuy.verified, true);
assert.strictEqual(receiptBuy.actualOutputAmount, 5000000); // 6M - 1M
assert.strictEqual(receiptBuy.actualFeeSol, 0.00001);
console.log('  ✔ Exact token output derived from on-chain pre/post token balance delta: 5000000 base units');

// ==================== TEST 7: Confirmed Receipt Verification (SELL) & Exact SOL proceeds ====================
console.log('▶ [TEST 7] Confirmed receipt verification & exact SOL proceeds with fee (SELL)');
const successfulSellTxDetails = {
  slot: 290195,
  transaction: {
    message: {
      accountKeys: [userPk, 'JupiterProgram11111111111111111111111111111'],
    },
  },
  meta: {
    err: null,
    fee: 15000,
    preBalances: [1000000000, 5000000000],
    postBalances: [1499985000, 4500000000], // Gross received = 1499985000 - 1000000000 + 15000 = 500000000 lamports (0.5 SOL)
  },
};
const receiptSell = verifyConfirmedReceipt({
  txDetails: successfulSellTxDetails,
  userPublicKey: userPk,
  inputMint: tokenMint,
  outputMint: 'So11111111111111111111111111111111111111112',
  isSolBuy: false,
});
assert.strictEqual(receiptSell.verified, true);
assert.strictEqual(receiptSell.actualOutputAmount, 500000000);
assert.strictEqual(receiptSell.actualFeeSol, 0.000015);
console.log('  ✔ Exact SOL proceeds derived from on-chain balance delta + fee: 500,000,000 lamports (0.5 SOL)');

// ==================== TEST 8: Protection Against Using Quote as Fake Realized Proceeds ====================
console.log('▶ [TEST 8] Protection against using Jupiter quote as fake realized proceeds');
const unverifiedTxDetails = {
  slot: 290199,
  transaction: { message: { accountKeys: [userPk] } },
  meta: {
    err: null,
    fee: 5000,
    preBalances: [1000000000],
    postBalances: [999995000], // No positive SOL received
  },
};
try {
  verifyConfirmedReceipt({
    txDetails: unverifiedTxDetails,
    userPublicKey: userPk,
    inputMint: tokenMint,
    outputMint: 'So11111111111111111111111111111111111111112',
    isSolBuy: false,
  });
  assert.fail('Should have rejected unverified balance delta');
} catch (err) {
  assert.strictEqual(classifyExecutionError(err), 'receipt_failure');
  assert.match(err.message, /CONFIRMED_RECEIPT_UNVERIFIED/);
}
console.log('  ✔ Receipt failure triggered on zero/missing on-chain balance delta without quote fallback');

console.log('\n🎉 ALL 8 JUPITER REPLAY AND FAILURE CLASSIFICATION TESTS PASSED SUCCESSFULLY!\n');
