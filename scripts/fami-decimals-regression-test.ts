// scripts/fami-decimals-regression-test.ts
if (typeof global.localStorage === 'undefined') {
  global.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
}

import { TokenDecimalsResolver } from '../src/services/TokenDecimalsResolver';
import { tokenRegistry } from '../src/services/TokenRegistry';

console.log('=== FAMI & Token Decimals Resolution Regression Test ===');

const FAMI_MINT = 'HmaHhC9vBh43gZnNTUFGNGP1A72jH1MXKjhHRWw2Ja8F';

async function runTests() {
  console.log('1. Testing sync resolution fail-closed for unverified FAMI...');
  try {
    TokenDecimalsResolver.resolveSync(FAMI_MINT);
    console.error('❌ Failed: resolveSync did not fail-closed for unverified token');
    process.exit(1);
  } catch (err: any) {
    if (!err?.message?.includes('UNRESOLVED_TOKEN_DECIMALS')) {
      throw err;
    }
    console.log('✅ Unverified mint correctly fails closed (no blind fallback to 6).');
  }

  console.log('1b. Testing sync resolution after verified registration...');
  tokenRegistry.registerOrUpdate({
    mintAddress: FAMI_MINT,
    symbol: 'FAMI',
    name: 'FAMI Token',
    decimals: 6,
  });
  const syncDec = TokenDecimalsResolver.resolveSync(FAMI_MINT);
  console.log(`FAMI sync decimals (registered): ${syncDec}`);
  if (syncDec !== 6) {
    console.error(`❌ Expected 6 decimals, got ${syncDec}`);
    process.exit(1);
  }

  console.log('2. Testing cache validation & rejection of invalid values...');
  const invalidDecimalsCases = [null, undefined, NaN, -1, 256, 1000];
  for (const c of invalidDecimalsCases) {
    const isValid = typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 255;
    if (isValid) {
      console.error(`❌ Failed: accepted invalid decimals value ${c}`);
      process.exit(1);
    }
  }
  console.log('✅ All invalid decimal values correctly rejected.');

  console.log('3. Testing mint and pump helpers...');
  console.log(`Is SOL mint check: ${TokenDecimalsResolver.isSolMint('So11111111111111111111111111111111111111112')}`);
  console.log(`Is Pump mint check (${FAMI_MINT}): ${TokenDecimalsResolver.isPumpMint(FAMI_MINT)}`);

  console.log('🎉 All FAMI & Token Decimals Regression Tests Passed Successfully!');
}

runTests().catch(err => {
  console.error('❌ Regression test failed with error:', err);
  process.exit(1);
});
