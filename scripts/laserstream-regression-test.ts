import { laserStreamWatchdog } from '../server/services/LaserStreamWatchdog.js';
import assert from 'assert';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  console.log('Running LaserStream regression tests...');

  let reconnectCount = 0;
  laserStreamWatchdog.setReconnectHandler(() => {
    reconnectCount++;
    return Promise.resolve();
  });

  // 1. Startup must not report connected until the transport is confirmed.
  laserStreamWatchdog.reset(false);
  laserStreamWatchdog.setTransportState(false, 'auto', 'grpc', 'mainnet');
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'connecting');

  laserStreamWatchdog.setTransportState(true, 'auto', 'grpc', 'mainnet');
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'connected');

  // 2. Normal quiet periods are degraded, not disconnected or reconnected.
  const baseReconnects = reconnectCount;
  (laserStreamWatchdog as any).lastEventAt = Date.now() - 65_000;
  (laserStreamWatchdog as any).lastHeartbeatAt = Date.now() - 65_000;
  (laserStreamWatchdog as any).connectedAt = Date.now() - 65_000;
  laserStreamWatchdog.evaluateHealth();
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'degraded');
  assert.strictEqual(reconnectCount, baseReconnects);

  // 3. Prolonged silence must leave degraded and enter the real reconnect path.
  laserStreamWatchdog.reset(false);
  laserStreamWatchdog.setTransportState(true, 'auto', 'grpc', 'mainnet');
  const beforeExtendedStale = reconnectCount;
  const now = Date.now();
  (laserStreamWatchdog as any).lastEventAt = now - 181_000;
  (laserStreamWatchdog as any).lastHeartbeatAt = now - 181_000;
  (laserStreamWatchdog as any).connectedAt = now - 181_000;
  laserStreamWatchdog.evaluateHealth();
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'disconnected');
  assert.strictEqual(reconnectCount, beforeExtendedStale + 1);

  // 4. setDisconnected() must emit a real transition and reconnect exactly once.
  laserStreamWatchdog.reset(false);
  laserStreamWatchdog.setTransportState(true, 'auto', 'grpc', 'mainnet');
  const beforeManualDisconnect = reconnectCount;
  laserStreamWatchdog.setDisconnected();
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'disconnected');
  assert.strictEqual(reconnectCount, beforeManualDisconnect + 1);
  laserStreamWatchdog.evaluateHealth();
  assert.strictEqual(reconnectCount, beforeManualDisconnect + 1);

  // 5. Fatal provider denial disables without reconnecting.
  laserStreamWatchdog.setDisabled('Subscription does not include Yellowstone gRPC access');
  assert.strictEqual(laserStreamWatchdog.getMetrics().status, 'disabled');
  assert.strictEqual(reconnectCount, beforeManualDisconnect + 1);

  // 6. reset() must clear every diagnostic counter.
  laserStreamWatchdog.reset(false);
  laserStreamWatchdog.recordRawUpdate();
  laserStreamWatchdog.recordInvalidUpdate();
  laserStreamWatchdog.recordRejectedUpdate();
  laserStreamWatchdog.recordDuplicateUpdate();
  laserStreamWatchdog.recordQueuedUpdate();
  laserStreamWatchdog.recordProcessingFailure();
  laserStreamWatchdog.recordReceivedEvent(100);
  laserStreamWatchdog.recordProcessedEvent(100, 1);
  laserStreamWatchdog.reset();
  const metrics = laserStreamWatchdog.getMetrics();
  assert.strictEqual(metrics.rawUpdatesReceived, 0);
  assert.strictEqual(metrics.invalidUpdates, 0);
  assert.strictEqual(metrics.rejectedUpdates, 0);
  assert.strictEqual(metrics.duplicateUpdates, 0);
  assert.strictEqual(metrics.queuedUpdates, 0);
  assert.strictEqual(metrics.processingFailures, 0);
  assert.strictEqual(metrics.eventsReceived, 0);
  assert.strictEqual(metrics.eventsProcessed, 0);

  // Avoid keeping the process alive because the watchdog owns an interval.
  laserStreamWatchdog.stop();
  await sleep(1);
  console.log('All LaserStream regression tests passed!');
}

runTests().catch(err => {
  console.error(err);
  laserStreamWatchdog.stop();
  process.exitCode = 1;
});
