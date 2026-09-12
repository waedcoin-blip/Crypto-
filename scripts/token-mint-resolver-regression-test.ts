import assert from 'assert';
import { tokenMintResolver } from '../server/market/TokenMintResolver.js';
import { candidateRegistry } from '../server/market/CandidateRegistry.js';
import { hardenedApprovalStore } from '../server/trading/HardenedApprovalStore.js';
import { positionValuationEngine } from '../server/trading/PositionValuationEngine.js';
import { momentumEngine } from '../server/trading/MomentumEngine.js';
import { rebuyGuard } from '../server/trading/RebuyGuard.js';

async function runRegressionTests() {
  console.log('=== STARTING TOKEN MINT RESOLVER REGRESSION TESTS ===');

  // A. Valid Pump.fun-style mint
  const pumpMint = 'HJE2DEZXvErwUabTU16xzrS629qXVeVyTGvJYJVfpump';
  assert.strictEqual(tokenMintResolver.isValidMint(pumpMint), true, 'Pump.fun-style mint ending in "pump" must be valid');

  // B. Valid normal Solana public key
  const normalMint = 'DezXAZ8z7Pnrn7jrr2R97tYFrb73k8jEgCgN7fok1TaF'; // BONK
  assert.strictEqual(tokenMintResolver.isValidMint(normalMint), true, 'Valid Solana public key must be valid');

  // C. Invalid Base58 characters (contains 'O', 'I', 'l', '0')
  const invalidBase58_1 = 'DezXAZ8z7Pnrn7jrr2R97tYFrb73k8jEgCgN7fok1TaO';
  const invalidBase58_2 = 'DezXAZ8z7Pnrn7jrr2R97tYFrb73k8jEgCgN7fok1TaI';
  const invalidBase58_3 = 'DezXAZ8z7Pnrn7jrr2R97tYFrb73k8jEgCgN7fok1Tal';
  const invalidBase58_4 = 'DezXAZ8z7Pnrn7jrr2R97tYFrb73k8jEgCgN7fok1Ta0';
  assert.strictEqual(tokenMintResolver.isValidMint(invalidBase58_1), false, 'Base58 containing "O" must be invalid');
  assert.strictEqual(tokenMintResolver.isValidMint(invalidBase58_2), false, 'Base58 containing "I" must be invalid');
  assert.strictEqual(tokenMintResolver.isValidMint(invalidBase58_3), false, 'Base58 containing "l" must be invalid');
  assert.strictEqual(tokenMintResolver.isValidMint(invalidBase58_4), false, 'Base58 containing "0" must be invalid');

  // D. Wrong-length address (too short / too long)
  const shortAddress = 'DezXAZ8z7Pnrn7jrr2R97tYFrb73k8jE'; // 31 chars
  const longAddress = 'DezXAZ8z7Pnrn7jrr2R97tYFrb73k8jEgCgN7fok1TaFaaaa'; // 48 chars
  assert.strictEqual(tokenMintResolver.isValidMint(shortAddress), false, 'Short address must be invalid');
  assert.strictEqual(tokenMintResolver.isValidMint(longAddress), false, 'Long address must be invalid');

  // E. Empty string
  assert.strictEqual(tokenMintResolver.isValidMint(''), false, 'Empty address must be invalid');

  // F. Whitespace around a valid address
  const paddedMint = '  DezXAZ8z7Pnrn7jrr2R97tYFrb73k8jEgCgN7fok1TaF  ';
  assert.strictEqual(tokenMintResolver.isValidMint(paddedMint), true, 'Padded address must be recognized as valid');

  // G. Mixed-case Base58 address must NOT be normalized by lowercasing
  // Verify that TokenMintResolver classifyAddress maintains case
  const classification = tokenMintResolver.classifyAddress(pumpMint);
  assert.strictEqual(classification.isValidMint, true);
  // Verify that we do not lowercase or modify the address casing
  const extracted = tokenMintResolver.extractMintFromLogs([`mint: ${pumpMint}`]);
  assert.strictEqual(extracted, pumpMint, 'Casing must be exactly preserved when extracting from logs');

  // H. TestMint... must NOT bypass strict PublicKey validation
  const oldTestMint = 'TestMint111111111111111111111111111111111111';
  assert.strictEqual(tokenMintResolver.isValidMint(oldTestMint), false, 'Legacy TestMint strings must fail strict PublicKey validation');
  
  // Synthetic test tokens starting with TEST_FIXTURE must be accepted
  const testFixtureMint = 'TEST_FIXTURE_MockToken12345';
  assert.strictEqual(tokenMintResolver.isValidMint(testFixtureMint), true, 'Synthetic tokens marked with TEST_FIXTURE prefix are valid');

  // I. Same canonical mint must produce the same cache/approval/registry key everywhere
  // Registering a candidate with mixed case
  const network = 'paper';
  candidateRegistry.registerCandidate({
    mint: pumpMint,
    network,
    source: 'LASERSTREAM',
  });
  
  const fetchedCandidate = candidateRegistry.getCandidate(network, pumpMint);
  assert.ok(fetchedCandidate, 'Candidate should be retrievable');
  assert.strictEqual(fetchedCandidate.mint, pumpMint, 'Candidate mint casing must be preserved');

  // Querying with lowercased version should return undefined because Solana addresses are case-sensitive
  const lowercasePumpMint = pumpMint.toLowerCase();
  const fetchedWithLowercase = candidateRegistry.getCandidate(network, lowercasePumpMint);
  assert.strictEqual(fetchedWithLowercase, undefined, 'Querying with lowercase mint must return undefined to prevent collisions');

  // J. Same exact mixed-case behavior in HardenedApprovalStore
  const approvalId = 'app_123';
  hardenedApprovalStore.issueApproval({
    approvalId,
    mint: pumpMint,
    chain: 'solana',
    state: 'ISSUED',
    expiresAt: Date.now() + 100000,
    criteriaVersion: '1.0',
    evaluatedSlot: 1000,
    evaluationPrice: 0.1,
    maxSlotLag: 100,
    maxPriceDeviationPct: 5,
  } as any);

  const usableApproval = hardenedApprovalStore.getLatestUsableApproval('solana', pumpMint);
  assert.ok(usableApproval, 'Usable approval should be found');
  assert.strictEqual(usableApproval.mint, pumpMint, 'Usable approval mint casing must match exactly');

  // Position Valuation Engine test
  const wallet = 'default';
  const mockValuation = {
    mint: pumpMint,
    tokenAmountRaw: 100000000n,
    tokenDecimals: 6,
    entryCostSol: 0.1,
    valuationUpdatedAt: Date.now(),
    status: 'LIVE',
  };
  (positionValuationEngine as any).valuations.set(`${network}:${wallet}:${pumpMint}`, mockValuation);

  positionValuationEngine.recordMarketPrice(network, wallet, pumpMint, 0.05, 'WSS');
  const val = positionValuationEngine.getValuation(network, wallet, pumpMint);
  assert.ok(val, 'Valuation should exist');
  assert.strictEqual(val.mint, pumpMint, 'Valuation mint casing must match exactly');

  // Momentum Engine test
  const mockMetrics = {
    mint: pumpMint,
    priceVelocity: 0.1,
    priceAcceleration: 0.0,
    buyVelocity: 1.0,
    buyAcceleration: 0.0,
    sellVelocity: 0.0,
    sellAcceleration: 0.0,
    volumeVelocity: 1.0,
    volumeAcceleration: 0.0,
    uniqueBuyerVelocity: 1.0,
    uniqueBuyerAcceleration: 0.0,
    transactionVelocity: 1.0,
    liquidityVelocity: 0.0,
    liquidityAcceleration: 0.0,
    buySellRatio: 1.0,
    netBuyPressure: 1.0,
    bondingCurveVelocity: 0.0,
    migrationMomentum: 0.0,
    momentumScore: 50,
  };
  (momentumEngine as any).lastMetrics.set(pumpMint, mockMetrics);

  momentumEngine.recordEvent(pumpMint, { price: 0.05, isBuy: true, solAmount: 1, buyer: 'alice' });
  const metrics = momentumEngine.getMetrics(pumpMint);
  assert.ok(metrics, 'Momentum metrics should exist');
  assert.strictEqual(metrics.mint, pumpMint, 'Momentum mint casing must match exactly');

  // Rebuy Guard test
  const res = rebuyGuard.reserveBuy({ network, wallet, mint: pumpMint, amountSol: 1 });
  assert.ok(res.reservationId, 'Rebuy reservation must succeed');
  rebuyGuard.confirmBuy(res.reservationId);

  console.log('=== ALL REGRESSION TESTS PASSED SUCCESSFULLY! ===');
}

runRegressionTests().catch(err => {
  console.error('❌ REGRESSION TEST FAILED:', err);
  process.exit(1);
});
