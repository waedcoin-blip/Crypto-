// scripts/bug003-execution-gateway-routing-regression.mjs
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}
import assert from 'assert';

console.log('--- STARTING BUG-003 EXECUTION GATEWAY ROUTING REGRESSION TEST ---');

async function main() {
  const { executionGateway } = await import('../server/execution/ExecutionGateway.js');

  // 1. Test explicit network overrides
  assert.strictEqual(executionGateway.resolveNetwork('mainnet'), 'mainnet', 'Should resolve mainnet');
  assert.strictEqual(executionGateway.resolveNetwork('mainnet-beta'), 'mainnet', 'Should resolve mainnet-beta');
  assert.strictEqual(executionGateway.resolveNetwork('devnet'), 'devnet', 'Should resolve devnet');
  assert.strictEqual(executionGateway.resolveNetwork('paper'), 'paper', 'Should resolve paper');

  // 2. Test real base58 Solana public keys (which do NOT start with 'devnet' or 'mainnet')
  const realSolanaWallet = 'Cj3upTXz6cYCP1TLbyF5AseKX4hqaWK7eiRqR7uu6npU';
  assert.strictEqual(
    executionGateway.resolveNetwork('mainnet', realSolanaWallet),
    'mainnet',
    'Real Solana public key with explicit mainnet network must resolve to mainnet'
  );
  assert.strictEqual(
    executionGateway.resolveNetwork('devnet', realSolanaWallet),
    'devnet',
    'Real Solana public key with explicit devnet network must resolve to devnet'
  );
  assert.strictEqual(
    executionGateway.resolveNetwork(undefined, realSolanaWallet),
    'paper',
    'Real Solana public key without explicit network defaults safely to paper'
  );

  // 3. Test scoped prefixes
  assert.strictEqual(executionGateway.resolveNetwork(undefined, 'mainnet:default'), 'mainnet', 'Scoped mainnet wallet prefix');
  assert.strictEqual(executionGateway.resolveNetwork(undefined, 'devnet:default'), 'devnet', 'Scoped devnet wallet prefix');
  assert.strictEqual(executionGateway.resolveNetwork(undefined, 'paper:default'), 'paper', 'Scoped paper wallet prefix');

  // 4. Test executor selection
  const mainnetExec = executionGateway.getExecutor('mainnet');
  assert(mainnetExec.constructor.name === 'MainnetTradeExecutor', 'Must return MainnetTradeExecutor');

  const devnetExec = executionGateway.getExecutor('devnet');
  assert(devnetExec.constructor.name === 'DevnetTradeExecutor', 'Must return DevnetTradeExecutor');

  const paperExec = executionGateway.getExecutor('paper');
  assert(paperExec.constructor.name === 'PaperTradeExecutor', 'Must return PaperTradeExecutor');

  console.log('ALL BUG-003 REGRESSION TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
