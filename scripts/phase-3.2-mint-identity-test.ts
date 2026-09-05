import { canonicalizeSolanaMint, validateSolanaMint } from '../src/utils/solanaValidators.js';
import { tokenMintResolver } from '../server/market/TokenMintResolver.js';
import { CanonicalEventNormalizer } from '../server/market/CanonicalEventNormalizer.js';
import { candidateRegistry } from '../server/market/CandidateRegistry.js';
import { hardenedApprovalStore } from '../server/trading/HardenedApprovalStore.js';
import assert from 'assert';

async function runTests() {
  console.log('Running Phase 3.2 Canonical Mint Identity Tests...');

  const validMint = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'; // Raydium
  const invalidMintSymbol = 'RAY';
  const invalidMintName = 'Raydium';
  const invalidMintAddress = 'INVALID_ADDRESS_NOT_32_BYTES';

  // 1. Valid Mint
  assert.strictEqual(validateSolanaMint(validMint).valid, true, 'Valid mint should pass');
  assert.strictEqual(canonicalizeSolanaMint(validMint), validMint, 'Canonicalize should return the same valid mint');

  // 2. Symbol as Mint
  assert.strictEqual(validateSolanaMint(invalidMintSymbol).valid, false, 'Symbol should fail validation');
  assert.throws(() => canonicalizeSolanaMint(invalidMintSymbol), /INVALID_MINT: INVALID_/, 'Symbol should throw on canonicalize');

  // 3. Name as Mint
  assert.strictEqual(validateSolanaMint(invalidMintName).valid, false, 'Name should fail validation');
  assert.throws(() => canonicalizeSolanaMint(invalidMintName), /INVALID_MINT: INVALID_/, 'Name should throw on canonicalize');

  // 4. Pool as Mint (if it's not a valid 32 byte base58)
  assert.strictEqual(validateSolanaMint(invalidMintAddress).valid, false, 'Invalid address should fail validation');
  assert.throws(() => canonicalizeSolanaMint(invalidMintAddress), /INVALID_MINT: INVALID_/, 'Invalid address should throw on canonicalize');

  // 5. Ingestion Pipeline Rejecting invalid mints
  const badEvent = CanonicalEventNormalizer.normalizePulseTrade({
    tokenAddress: invalidMintSymbol,
    type: 'BUY',
    slot: 12345
  });
  assert.strictEqual(badEvent, null, 'Normalizer should return null for invalid mints');

  const goodEvent = CanonicalEventNormalizer.normalizePulseTrade({
    tokenAddress: validMint,
    type: 'BUY',
    slot: 12345
  });
  assert.notStrictEqual(goodEvent, null, 'Normalizer should return valid event for valid mints');
  assert.strictEqual(goodEvent?.mint, validMint, 'Normalizer should set correct canonical mint');

  // 6. Registry enforces canonical mint
  const { candidate } = candidateRegistry.registerOrUpdateCandidate(goodEvent!);
  assert.strictEqual(candidate.mint, validMint, 'Candidate should have canonical mint');
  
  // 7. Approval Mismatch (Attempting to get candidate with bad mint)
  const missingCandidate = candidateRegistry.getCandidate('mainnet', invalidMintSymbol);
  assert.strictEqual(missingCandidate, undefined, 'getCandidate should return undefined for invalid mints');

  // 8. Server Auth
  const approval = hardenedApprovalStore.issueApproval({
    approvalId: 'test_approval_1',
    chain: 'solana',
    mint: validMint, // Using valid mint
    criteriaVersion: 'v1',
    evaluatedSlot: 100,
    evaluationPrice: 10,
    maxSlotLag: 100,
    maxPriceDeviationPct: 5,
    state: 'ISSUED',
    expiresAt: Date.now() + 10000,
    decisionHash: 'hash',
    evaluatedAt: Date.now(),
    checks: [],
    correlationId: 'test_corr_1'
  });
  
  assert.strictEqual(approval.mint, validMint, 'Approval should have canonical mint');
  
  const fetchedApproval = hardenedApprovalStore.getLatestUsableApproval('solana', validMint);
  assert.notStrictEqual(fetchedApproval, undefined, 'Should be able to fetch approval with valid mint');

  const fetchedApprovalBad = hardenedApprovalStore.getLatestUsableApproval('solana', invalidMintSymbol);
  assert.strictEqual(fetchedApprovalBad, undefined, 'Fetching approval with invalid mint should return undefined');

  console.log('All 10 Phase 3.2 Canonical Mint Identity Tests Passed ✅');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
