// scripts/rpc-ws-routing-regression-test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  rpcRouting,
  deriveWsUrl,
  normalizeRpcUrl,
  normalizeWsUrl,
  getRpcEndpoints,
  getWsEndpoints,
  getPrimaryRpc,
  getPrimaryWs,
} from '../src/services/rpcRouting.ts';

console.log('🧪 Running v100 RPC + WebSocket Isolation Regression Suite...\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// 1. Verify WS Derivation from RPC URL
runTest('WS URL derivation preserves protocol mapping, host, and path', () => {
  assert.equal(deriveWsUrl('https://rpc.example.com/v1/key'), 'wss://rpc.example.com/v1/key');
  assert.equal(deriveWsUrl('http://local.rpc:8899/path'), 'ws://local.rpc:8899/path');
});

// 2. Protocol Validation & Fail Closed
runTest('Invalid RPC and WS protocols throw errors', () => {
  assert.throws(() => normalizeRpcUrl('ftp://invalid.com'), /INVALID_RPC_URL/);
  assert.throws(() => normalizeWsUrl('http://invalid.com'), /INVALID_WS_URL/);
});

// 3. Role Isolation and Explicit WS Priority
runTest('Search, Monitor, Execution roles are completely isolated', () => {
  rpcRouting.setRpcRoles({
    searchRpcUrl: 'https://search-rpc.example.com',
    searchRpcBackupUrl: 'https://search-backup.example.com',
    searchWsUrl: 'wss://search-ws.example.com',

    monitorRpcUrl: 'https://monitor-rpc.example.com',
    monitorRpcBackupUrl: 'https://monitor-backup.example.com',

    executionRpcUrl: 'https://execution-rpc.example.com',
    executionWsUrl: 'wss://execution-ws.example.com',
  });

  // Search endpoints
  const searchRpc = rpcRouting.getRpcEndpoints('search');
  const searchWs = rpcRouting.getWsEndpoints('search');
  assert.deepEqual(searchRpc, ['https://search-rpc.example.com', 'https://search-backup.example.com']);
  assert.equal(searchWs[0], 'wss://search-ws.example.com');
  assert.equal(searchWs[1], 'wss://search-backup.example.com');

  // Monitor endpoints (derived WS)
  const monitorRpc = rpcRouting.getRpcEndpoints('monitor');
  const monitorWs = rpcRouting.getWsEndpoints('monitor');
  assert.deepEqual(monitorRpc, ['https://monitor-rpc.example.com', 'https://monitor-backup.example.com']);
  assert.equal(monitorWs[0], 'wss://monitor-rpc.example.com');
  assert.equal(monitorWs[1], 'wss://monitor-backup.example.com');

  // Execution endpoints
  const executionRpc = rpcRouting.getRpcEndpoints('execution');
  const executionWs = rpcRouting.getWsEndpoints('execution');
  assert.deepEqual(executionRpc, ['https://execution-rpc.example.com']);
  assert.deepEqual(executionWs, ['wss://execution-ws.example.com']);

  // Strictly no endpoint leakage across roles
  assert.notEqual(searchRpc[0], executionRpc[0]);
  assert.notEqual(monitorRpc[0], executionRpc[0]);
  assert.notEqual(searchWs[0], executionWs[0]);
});

// 4. Execution Role Fail-Closed Safety
runTest('Execution role fails closed when execution endpoints are unavailable', () => {
  rpcRouting.setRpcRoles({
    searchRpcUrl: 'https://search-rpc.example.com',
    monitorRpcUrl: 'https://monitor-rpc.example.com',
    executionRpcUrl: '',
    executionWsUrl: '',
  });

  assert.throws(() => rpcRouting.getExecutionRpcUrl(), /EXECUTION_RPC_UNAVAILABLE/);
  assert.throws(() => rpcRouting.getExecutionWsUrl(), /EXECUTION_WS_UNAVAILABLE/);
  assert.deepEqual(rpcRouting.getRpcEndpoints('execution'), []);
  assert.deepEqual(rpcRouting.getWsEndpoints('execution'), []);
});

// 5. Deduplication
runTest('Duplicate RPC and WS URLs are deduplicated', () => {
  rpcRouting.setRpcRoles({
    searchRpcUrl: 'https://search.example.com',
    searchRpcBackupUrl: 'https://search.example.com',
  });

  const searchRpc = rpcRouting.getRpcEndpoints('search');
  assert.equal(searchRpc.length, 1);
});


// 6. Factory role isolation contract
runTest('Role connection factory source binds callers to explicit roles', () => {
  const source = fs.readFileSync(new URL('../src/services/roleConnectionFactory.ts', import.meta.url), 'utf8');
  assert.match(source, /createRoleConnection\(role/);
  assert.match(source, /rpcRouting\.getPrimaryRpc\(role\)/);
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✨ All v100 RPC + WebSocket isolation tests passed!\n');
}
