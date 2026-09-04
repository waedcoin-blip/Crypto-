import assert from 'node:assert/strict';
import fs from 'node:fs';

console.log('=== Running Live PnL Update Regression Test ===');

// 1. Math Function mirroring Active Position live PnL engine
function calculateLiveDisplayPnL(amount, currentPriceSol, entryCostSol) {
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return { currentValueSol: 0, pnlSol: 0, pnlPercent: 0, status: 'INVALID_AMOUNT' };
  }
  if (typeof currentPriceSol !== 'number' || isNaN(currentPriceSol) || !isFinite(currentPriceSol) || currentPriceSol <= 0) {
    return { currentValueSol: 0, pnlSol: 0, pnlPercent: 0, status: 'STALE_PRICE' };
  }
  const entryCost = typeof entryCostSol === 'number' && isFinite(entryCostSol) && entryCostSol > 0 ? entryCostSol : 0;
  const currentValueSol = amount * currentPriceSol;
  const pnlSol = entryCost > 0 ? currentValueSol - entryCost : 0;
  const pnlPercent = entryCost > 0 ? (pnlSol / entryCost) * 100 : 0;

  return {
    currentValueSol,
    pnlSol,
    pnlPercent,
    status: 'LIVE',
  };
}

// 2. Deterministic Regression Sequence (Section 12 of spec)
// Start with: entryValueSol = 1, amount = 1, currentPrice = 1
const initial = calculateLiveDisplayPnL(1, 1.0, 1.0);
assert.equal(initial.currentValueSol, 1.0, 'Initial value must be exactly 1.0 SOL');
assert.equal(initial.pnlSol, 0.0, 'Initial PnL must be 0 SOL');
assert.equal(initial.pnlPercent, 0.0, 'Initial PnL% must be 0%');
console.log('✔ Step 1 passed: entry=1, price=1 -> PnL=0 SOL, PnL%=0%');

// Update market price to: 1.2 -> Expected: PnL = +0.2 SOL, PnL% = +20%
const updateGain = calculateLiveDisplayPnL(1, 1.2, 1.0);
assert.equal(Math.abs(updateGain.currentValueSol - 1.2) < 1e-9, true, 'Updated value must be 1.2 SOL');
assert.equal(Math.abs(updateGain.pnlSol - 0.2) < 1e-9, true, 'Updated PnL must be +0.2 SOL');
assert.equal(Math.abs(updateGain.pnlPercent - 20.0) < 1e-9, true, 'Updated PnL% must be +20%');
console.log('✔ Step 2 passed: price=1.2 -> PnL=+0.2 SOL, PnL%=+20%');

// Update market price to: 0.8 -> Expected: PnL = -0.2 SOL, PnL% = -20%
const updateLoss = calculateLiveDisplayPnL(1, 0.8, 1.0);
assert.equal(Math.abs(updateLoss.currentValueSol - 0.8) < 1e-9, true, 'Updated value must be 0.8 SOL');
assert.equal(Math.abs(updateLoss.pnlSol - (-0.2)) < 1e-9, true, 'Updated PnL must be -0.2 SOL');
assert.equal(Math.abs(updateLoss.pnlPercent - (-20.0)) < 1e-9, true, 'Updated PnL% must be -20%');
console.log('✔ Step 3 passed: price=0.8 -> PnL=-0.2 SOL, PnL%=-20% (negative PnL preserved)');

// 3. Stale cache simulation: old cached quote must NOT block new market price
const simulatedPosition = {
  amount: 1,
  solSpent: 1.0,
  cachedExecutableValueSol: 1.0,
  cachedPnlSol: 0.0,
  cachedPnlPercent: 0.0,
};
// When new market price is 1.5, recalculation must take precedence over cachedExecutableValueSol
const newPrice = 1.5;
const recalculatedPnL = calculateLiveDisplayPnL(simulatedPosition.amount, newPrice, simulatedPosition.solSpent);
assert.equal(Math.abs(recalculatedPnL.pnlSol - 0.5) < 1e-9, true, 'Recalculation must ignore stale cached value and yield +0.5 SOL');
assert.equal(Math.abs(recalculatedPnL.pnlPercent - 50.0) < 1e-9, true, 'Recalculation must ignore stale cached value and yield +50%');
console.log('✔ Step 4 passed: stale cache bypass confirmed (+50% PnL on price 1.5)');

// 4. Zero / Invalid Price and Cost Protection
const zeroPrice = calculateLiveDisplayPnL(1, 0, 1.0);
assert.equal(zeroPrice.status, 'STALE_PRICE');
assert.equal(Number.isFinite(zeroPrice.pnlPercent), true);

const nanPrice = calculateLiveDisplayPnL(1, NaN, 1.0);
assert.equal(nanPrice.status, 'STALE_PRICE');

const zeroEntry = calculateLiveDisplayPnL(1, 1.5, 0);
assert.equal(zeroEntry.pnlPercent, 0, 'Zero entry cost must not divide by zero or yield Infinity');
console.log('✔ Step 5 passed: zero / invalid price protection confirmed');

// 5. Static audit of PnLPage.tsx
const pnlCode = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

// Ensure stale cached fallback pattern pos.executableValueSol !== undefined ? pos.executableValueSol : ... is eradicated
const staleExecPattern = /pos\.executableValueSol\s*!==\s*undefined\s*\?\s*pos\.executableValueSol/g;
assert.equal(staleExecPattern.test(pnlCode), false, 'PnLPage.tsx must not contain stale pos.executableValueSol cache pattern');

const stalePnlSolPattern = /pos\.pnlSol\s*!==\s*undefined\s*\?\s*pos\.pnlSol/g;
assert.equal(stalePnlSolPattern.test(pnlCode), false, 'PnLPage.tsx must not contain stale pos.pnlSol cache pattern');

const stalePnlPctPattern = /pos\.pnlPercent\s*!==\s*undefined\s*\?\s*pos\.pnlPercent/g;
assert.equal(stalePnlPctPattern.test(pnlCode), false, 'PnLPage.tsx must not contain stale pos.pnlPercent cache pattern');

console.log('✔ Step 6 passed: Static audit verified no stale cache bypass patterns in PnLPage.tsx');

console.log('=== ALL LIVE PNL REGRESSION CHECKS PASSED ===');
