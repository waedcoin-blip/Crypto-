// scripts/helius-wss-regression-test.ts
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { sanitizeApiKey, maskApiKey, HeliusApiKeyMissingError, HeliusGrpcUnavailableError } from '../server/market/HeliusErrors.js';
import { OnChainEventNormalizer } from '../server/market/OnChainEventNormalizer.js';
import { HeliusLaserStreamWssManager } from '../server/market/HeliusLaserStreamWssManager.js';
import { StreamingTransportManager } from '../server/market/StreamingTransportManager.js';
import { config } from '../server/config/index.js';

let failedTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✔ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ' -> ' + detail : ''}`);
    failedTests++;
  }
}

async function runRegressionSuite() {
  console.log('\n🚀 Starting Helius LaserStream / Standard WSS Ingestion Regression Suite...\n');

  // ─── TEST 1: Sanitization & Masking ───
  console.log('▶ [TEST 1] Key Sanitization & Redaction Security');
  const sampleKey = '12345678-abcd-ef01-2345-6789abcdef01';
  const urlWithKey = `https://mainnet.helius-rpc.com/?api-key=${sampleKey}`;
  const wssWithKey = `wss://mainnet.helius-rpc.com/?api-key=${sampleKey}`;

  assert(sanitizeApiKey(urlWithKey) === sampleKey, 'Extracts API key from HTTP URL query param');
  assert(sanitizeApiKey(wssWithKey) === sampleKey, 'Extracts API key from WSS URL query param');
  assert(sanitizeApiKey(sampleKey) === sampleKey, 'Preserves bare API key');
  assert(maskApiKey(sampleKey) === '1234...ef01', 'Masks API key safely (first 4 + last 4)');
  assert(maskApiKey(undefined) === '[NOT CONFIGURED]', 'Handles undefined API key cleanly');

  // ─── TEST 2: Custom Helius Error Hierarchy ───
  console.log('\n▶ [TEST 2] Typed Helius Error Classes');
  const missingKeyErr = new HeliusApiKeyMissingError();
  assert(missingKeyErr.code === 'HELIUS_API_KEY_MISSING', 'HeliusApiKeyMissingError has code HELIUS_API_KEY_MISSING');
  assert(missingKeyErr.statusCode === 401, 'HeliusApiKeyMissingError has 401 status code');

  const grpcErr = new HeliusGrpcUnavailableError();
  assert(grpcErr.code === 'HELIUS_GRPC_UNAVAILABLE', 'HeliusGrpcUnavailableError has code HELIUS_GRPC_UNAVAILABLE');
  assert(grpcErr.statusCode === 503, 'HeliusGrpcUnavailableError has 503 status code');

  // ─── TEST 3: OnChainEventNormalizer ───
  console.log('\n▶ [TEST 3] OnChainEventNormalizer Solana JSON-RPC Parsing');
  
  // 3a. Slot update notification
  const slotMsg = {
    jsonrpc: '2.0',
    method: 'slotNotification',
    params: {
      result: { parent: 362451000, root: 362450900, slot: 362451234 },
      subscription: 101,
    },
  };
  const normSlot = OnChainEventNormalizer.normalizeWssNotification(slotMsg, 'mainnet');
  assert(normSlot !== null, 'Slot notification normalized successfully');
  assert(normSlot?.slot === 362451234, 'Correct slot number extracted');
  assert(normSlot?.type === 'SLOT_UPDATE', 'Correct slot event type');
  assert(normSlot?.source === 'HELIUS_WSS', 'Source marked as HELIUS_WSS');

  // 3b. Logs update notification
  const logsMsg = {
    jsonrpc: '2.0',
    method: 'logsNotification',
    params: {
      result: {
        context: { slot: 362451235 },
        value: {
          signature: '5K2gA7yvFhXkZ6bU7m9...',
          err: null,
          logs: [
            'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
            'Program log: Instruction: Buy',
            'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
          ],
        },
      },
      subscription: 102,
    },
  };
  const normLogs = OnChainEventNormalizer.normalizeWssNotification(logsMsg, 'mainnet');
  assert(normLogs !== null, 'Logs notification normalized successfully');
  assert(normLogs?.signature === '5K2gA7yvFhXkZ6bU7m9...', 'Extracted signature from logs notification');
  assert(normLogs?.accountKeys?.includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') === true, 'Extracted program mention from logs');

  // 3c. Program/Account update notification
  const progMsg = {
    jsonrpc: '2.0',
    method: 'programNotification',
    params: {
      result: {
        context: { slot: 362451236 },
        value: {
          pubkey: 'DezXAZ8z7PnrnESzzrfUg1g8v1s1gT9E1Zqh9gLrwvD',
          account: {
            data: ['dGVzdA==', 'base64'],
            executable: false,
            lamports: 10000000,
            owner: '11111111111111111111111111111111',
            rentEpoch: 0,
          },
        },
      },
      subscription: 103,
    },
  };
  const normProg = OnChainEventNormalizer.normalizeWssNotification(progMsg, 'mainnet');
  assert(normProg !== null, 'Program notification normalized successfully');
  assert(normProg?.mint === 'DezXAZ8z7PnrnESzzrfUg1g8v1s1gT9E1Zqh9gLrwvD', 'Extracted pubkey as mint');
  assert(normProg?.type === 'ACCOUNT_UPDATE', 'Correct account event type');

  // ─── TEST 4: Live Mock WebSocket Server Interaction & Subscription Lifecycle ───
  console.log('\n▶ [TEST 4] Mock WSS Server & Full Subscription Lifecycle');

  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  
  let receivedRpcRequests: any[] = [];
  let activeMockSockets: WebSocket[] = [];

  wss.on('connection', (ws) => {
    activeMockSockets.push(ws);
    ws.on('message', (data) => {
      try {
        const req = JSON.parse(data.toString());
        receivedRpcRequests.push(req);

        // Auto respond with JSON-RPC result (mock subscription ID)
        if (req.id !== undefined && req.method?.endsWith('Subscribe')) {
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: Math.floor(Math.random() * 100000) + 1,
            })
          );
        }
      } catch {}
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as any).port;
  const mockWssUrl = `ws://127.0.0.1:${port}`;

  // Override configuration to use mock WSS server
  (config as any).SEARCH_WS_URL = mockWssUrl;
  (config as any).HELIUS_API_KEY = 'test-helius-key-12345';

  const wssManager = HeliusLaserStreamWssManager.getInstance();
  
  let receivedEvents: any[] = [];
  const started = await wssManager.start((event) => {
    receivedEvents.push(event);
  });

  assert(started === true, 'HeliusLaserStreamWssManager connected to mock server');
  await new Promise((r) => setTimeout(r, 100));

  // Verify that default subscriptions (slot + pump.fun + raydium + jupiter) were sent
  assert(receivedRpcRequests.length >= 4, `Sent initial subscriptions (count: ${receivedRpcRequests.length})`);
  const methods = receivedRpcRequests.map((r) => r.method);
  assert(methods.includes('slotSubscribe'), 'Includes slotSubscribe');
  assert(methods.includes('logsSubscribe'), 'Includes logsSubscribe');

  // Verify telemetry reports connected
  const telemetry = wssManager.getTelemetry();
  assert(telemetry.connected === true, 'Telemetry reports connected');
  assert(telemetry.transport === 'wss', 'Telemetry transport is WSS');

  // ─── TEST 5: Event Ingestion & Deduplication via WSS ───
  console.log('\n▶ [TEST 5] Event Notification Ingestion & Deduplication');
  
  if (activeMockSockets.length > 0) {
    const ws = activeMockSockets[0];
    
    // Broadcast slot event
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'slotNotification',
        params: {
          result: { slot: 362499999, parent: 362499998, root: 362499900 },
          subscription: 1,
        },
      })
    );

    await new Promise((r) => setTimeout(r, 50));
    assert(receivedEvents.length >= 1, 'Event received and dispatched through callback');
    assert(receivedEvents[0]?.slot === 362499999, 'Callback event has slot 362499999');

    // Send duplicate event
    const countBefore = receivedEvents.length;
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'slotNotification',
        params: {
          result: { slot: 362499999, parent: 362499998, root: 362499900 },
          subscription: 1,
        },
      })
    );
    await new Promise((r) => setTimeout(r, 50));
    assert(receivedEvents.length === countBefore, 'Duplicate slot event was dropped by LRU cache');
  }

  // ─── TEST 6: Fast Sell Signature Confirmation Monitoring ───
  console.log('\n▶ [TEST 6] Fast Sell Signature Confirmation Fast-Path');
  const testSignature = '3yG9Xv7Bq8N1p4Kj2m...sell_test';
  
  const confirmationPromise = wssManager.subscribeSignature(testSignature, undefined, 5000);

  await new Promise((r) => setTimeout(r, 50));
  // Send signature confirmation notification from mock server
  if (activeMockSockets.length > 0) {
    const ws = activeMockSockets[0];
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'signatureNotification',
        params: {
          result: {
            context: { slot: 362500100 },
            value: { err: null },
          },
          subscription: 999,
        },
      })
    );
  }

  const result = await confirmationPromise;
  assert(result.confirmed === true, 'Signature confirmed via WSS signatureSubscribe fast path');
  assert(result.slot === 362500100, 'Confirmation returned slot 362500100');

  // ─── TEST 7: StreamingTransportManager Orchestration ───
  console.log('\n▶ [TEST 7] StreamingTransportManager Orchestration');
  const transportMgr = StreamingTransportManager.getInstance();
  assert(transportMgr.getActiveTransport().transportName === 'wss', 'Default transport is Helius Standard WSS');
  const mgrTelemetry = transportMgr.getTelemetry();
  assert(mgrTelemetry.transport === 'wss', 'Manager telemetry matches active transport');

  // ─── CLEANUP ───
  await wssManager.stop();
  for (const s of activeMockSockets) {
    try { s.close(); } catch {}
  }
  await new Promise<void>((r) => server.close(() => r()));

  console.log('\n======================================================');
  console.log(`HELIUS WSS REGRESSION RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runRegressionSuite().catch((err) => {
  console.error('Fatal regression suite error:', err);
  process.exit(1);
});
