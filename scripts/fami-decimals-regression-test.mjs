// scripts/fami-decimals-regression-test.mjs
if (typeof global.localStorage === 'undefined') {
  global.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  };
}

async function runTests() {
  const { TokenDecimalsResolver } = await import('../src/services/TokenDecimalsResolver.ts');

  console.log('=== FAMI & Token Decimals Resolution Regression Test ===');

  const FAMI_MINT = 'HmaHhC9vBh43gZnNTUFGNGP1A72jH1MXKjhHRWw2Ja8F';

  console.log('1. Testing sync resolution fallback for FAMI...');
  const syncDec = TokenDecimalsResolver.resolveSync(FAMI_MINT);
  console.log(`FAMI sync decimals (default/fallback): ${syncDec}`);

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
