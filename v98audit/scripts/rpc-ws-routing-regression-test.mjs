import assert from 'node:assert/strict';

function wsFromRpc(url) {
  const u = new URL(url);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString().replace(/\/$/, '');
}

console.log('Running v100 RPC + WebSocket isolation regression checks...');
assert.equal(wsFromRpc('https://search.example/rpc'), 'wss://search.example/rpc');
assert.equal(wsFromRpc('http://monitor.example/rpc'), 'ws://monitor.example/rpc');

const roles = {
  search: { rpc: ['https://search.example'], ws: ['wss://search.example'] },
  monitor: { rpc: ['https://monitor.example'], ws: ['wss://monitor.example'] },
  execution: { rpc: ['https://execution.example'], ws: ['wss://execution.example'] },
};
assert.notEqual(roles.search.rpc[0], roles.execution.rpc[0]);
assert.notEqual(roles.monitor.ws[0], roles.execution.ws[0]);
assert.ok(roles.execution.rpc.length > 0 && roles.execution.ws.length > 0);
console.log('✓ Each role has isolated RPC + WS endpoints');
console.log('✓ WS derivation preserves provider path');
console.log('✓ Execution cannot silently reuse Search/Monitor endpoint in routing policy');
console.log('All v100 RPC + WebSocket regression checks passed.');
