import { laserStreamWatchdog } from '../server/services/LaserStreamWatchdog.js';
import assert from 'assert';

async function runTests() {
  console.log('Running LaserStream regression tests...');
  
  // 1. False CONNECTED state check
  laserStreamWatchdog.reset(false); // Reset to 'connecting' instead of 'disabled'
  laserStreamWatchdog.start();
  
  // Initial state should be disconnected if transport is not connected
  laserStreamWatchdog.setTransportState(false, 'auto', 'grpc', 'mainnet');
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'disconnected', 'Should be disconnected initially');

  // Should NOT be connected just because startLaserStream was called
  // Connection requires ping/pong/slot/transaction
  
  laserStreamWatchdog.setTransportState(true, 'auto', 'grpc', 'mainnet');
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'connected', 'Should be connected after transport state true');

  // 2. Activity-stale detection (12-second)
  console.log('Testing activity stale detection (12s)...');
  
  let reconnectCount = 0;
  laserStreamWatchdog.setReconnectHandler(() => {
    reconnectCount++;
    return Promise.resolve(); // Resolves but transport remains disconnected
  });

  // Hack: manually set lastActivity to 13 seconds ago
  (laserStreamWatchdog as any).lastEventAt = Date.now() - 13000;
  (laserStreamWatchdog as any).lastHeartbeatAt = Date.now() - 13000;
  (laserStreamWatchdog as any).connectedAt = Date.now() - 13000;
  
  laserStreamWatchdog.evaluateHealth();
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'disconnected', 'Should mark disconnected after 12s of inactivity');

  // 3. Test reconnect loops
  assert.strictEqual(reconnectCount, 1, 'Should trigger reconnect once');
  
  // evaluateHealth again should not trigger another reconnect immediately because of the 5s delay
  laserStreamWatchdog.evaluateHealth();
  assert.strictEqual(reconnectCount, 1, 'Should not trigger reconnect immediately (avoids loop)');

  console.log('All LaserStream regression tests passed!');
  process.exit(0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
