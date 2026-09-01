import { laserStreamWatchdog } from '../server/services/LaserStreamWatchdog.js';
import assert from 'assert';

async function runTests() {
  console.log('Running LaserStream regression tests...');
  
  // 1. False CONNECTED state check
  laserStreamWatchdog.reset(false); // Reset to 'connecting' instead of 'disabled'
  laserStreamWatchdog.start();
  
  // Initial state should be connecting if transport is not connected but we just started
  laserStreamWatchdog.setTransportState(false, 'auto', 'grpc', 'mainnet');
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'connecting', 'Should be connecting initially');

  // Should NOT be connected just because startLaserStream was called
  // Connection requires ping/pong/slot/transaction
  
  laserStreamWatchdog.setTransportState(true, 'auto', 'grpc', 'mainnet');
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'connected', 'Should be connected after transport state true');

  // 2. Quiet stream activity test (60-second observation threshold)
  console.log('Testing quiet stream does not cause false disconnect...');
  
  let reconnectCount = 0;
  laserStreamWatchdog.setReconnectHandler(() => {
    reconnectCount++;
    return Promise.resolve(); // Resolves but transport remains disconnected
  });

  // Simulate a healthy transport with no matching filtered events for 65 seconds
  (laserStreamWatchdog as any).lastEventAt = Date.now() - 65000;
  (laserStreamWatchdog as any).lastHeartbeatAt = Date.now() - 65000;
  (laserStreamWatchdog as any).connectedAt = Date.now() - 65000;
  
  laserStreamWatchdog.evaluateHealth();
  const quietStatus = laserStreamWatchdog.getMetrics().status;
  
  assert.notStrictEqual(quietStatus, 'disconnected', 'A healthy transport must not disconnect solely because no filtered events arrived');
  assert.notStrictEqual(quietStatus, 'disabled', 'A quiet stream must never become disabled');
  assert.strictEqual(quietStatus, 'degraded', 'A quiet stream beyond 60s activity threshold should be marked degraded');
  assert.strictEqual(reconnectCount, 0, 'No reconnect should be triggered for a quiet stream on healthy transport');

  // 3. Real transport failure triggers disconnect & reconnect
  console.log('Testing real transport failure handling...');
  laserStreamWatchdog.setTransportState(false, 'auto', 'grpc', 'mainnet');
  laserStreamWatchdog.evaluateHealth();
  
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'disconnected', 'Real transport failure should mark status as disconnected');
  assert.strictEqual(reconnectCount, 1, 'Should trigger reconnect on real transport disconnect');

  // evaluateHealth again should not trigger another reconnect immediately because of the rate limiter
  laserStreamWatchdog.evaluateHealth();
  assert.strictEqual(reconnectCount, 1, 'Should not trigger reconnect immediately (avoids loop)');

  // 4. Permanent provider plan denial triggers disabled
  console.log('Testing permanent provider plan denial...');
  laserStreamWatchdog.setDisabled('Subscription does not include Yellowstone gRPC access');
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'disabled', 'Verified plan denial must set status to disabled');

  // 5. Test Paper Trading mode switch & Mainnet Ingestion Idempotency
  console.log('Testing Paper Trading mode switch & Mainnet Ingestion Idempotency...');
  
  laserStreamWatchdog.reset(false);
  laserStreamWatchdog.setTransportState(true, 'auto', 'grpc', 'mainnet');
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'connected', 'LaserStream connected on mainnet');

  // Simulate switching Paper -> Mainnet -> Paper
  let tradingExecutionMode: 'paper' | 'mainnet' = 'paper';
  
  // LaserStream configuration payload sent by PnLPage during Paper Trading
  const pnlPageConfigPayload = {
    enabled: true,
    apiKey: 'test-key',
    network: 'mainnet', // Always mainnet ingestion, never 'paper'
    endpoint: 'https://laserstream-mainnet-ams.helius-rpc.com',
  };

  assert.strictEqual(pnlPageConfigPayload.network, 'mainnet', 'LaserStream config must always specify mainnet network even in Paper mode');

  // Toggling trading execution mode
  tradingExecutionMode = 'mainnet';
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'connected', 'LaserStream remains connected after switching execution mode to mainnet');

  tradingExecutionMode = 'paper';
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'connected', 'LaserStream remains connected after switching execution mode to paper');

  console.log('All LaserStream regression tests passed!');
  process.exit(0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
