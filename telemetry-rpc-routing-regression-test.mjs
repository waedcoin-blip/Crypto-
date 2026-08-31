// telemetry-rpc-routing-regression-test.mjs
import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('🧪 Running Telemetry & RPC Routing Regression Suite...\n');

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

// 1. Verify No Telemetry X-Ray HTML Scraping
runTest('No Telemetry X-Ray HTML Scraping in source code', () => {
  const scanDir = (dir) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
          scanDir(fullPath);
        }
      } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.mjs')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('app.telemetry.io/x-ray')) {
          throw new Error(`Found app.telemetry.io/x-ray reference in ${fullPath}`);
        }
      }
    }
  };

  scanDir(path.join(process.cwd(), 'src'));
  scanDir(path.join(process.cwd(), 'server'));
});

// 2. Verify 5s Monitor-Price Staleness
runTest('MasterMonitorService enforces 5s price staleness', () => {
  const fileContent = fs.readFileSync(path.join(process.cwd(), 'src/services/MasterMonitorService.ts'), 'utf8');
  assert(fileContent.includes('> 5000'), 'MasterMonitorService must check > 5000ms for price staleness');
});

// 3. Verify 10s Telemetry Stream Stall Detection
runTest('LaserstreamIngestion enforces 10s stream stall detection', () => {
  const fileContent = fs.readFileSync(path.join(process.cwd(), 'server/engines/LaserstreamIngestion.ts'), 'utf8');
  assert(fileContent.includes('> 10_000') || fileContent.includes('> 10000'), 'LaserstreamIngestion must check > 10000ms for stream stall');
  assert(!fileContent.includes('state.lastHeartbeatTime = Date.now();\n\n    // Differentiate'), 'Watchdog must not fake fresh heartbeat');
});

// 4. Verify RPC Role Isolation (Monitor RPC has no fallback to Execution/Search)
runTest('MasterMonitorService RPC isolation', () => {
  const fileContent = fs.readFileSync(path.join(process.cwd(), 'src/services/MasterMonitorService.ts'), 'utf8');
  assert(fileContent.includes('rpcRouting.getMonitorRpcUrl()'), 'MasterMonitorService must use rpcRouting.getMonitorRpcUrl()');
  assert(!fileContent.includes("getNetworkConfig('paper').rpcUrl"), 'MasterMonitorService must not fall back to paper default RPC');
});

// 5. Verify Execution RPC Isolation
runTest('MainnetJupiterExecutor uses Execution RPC', () => {
  const fileContent = fs.readFileSync(path.join(process.cwd(), 'src/services/MainnetJupiterExecutor.ts'), 'utf8');
  assert(fileContent.includes('rpcRouting.getExecutionRpcUrl()'), 'MainnetJupiterExecutor must use rpcRouting.getExecutionRpcUrl()');
});

// 6. Verify Direct WebSocket Fallback Removed from PnLPage
runTest('PnLPage direct WebSocket fallback removed', () => {
  const fileContent = fs.readFileSync(path.join(process.cwd(), 'src/components/pages/PnLPage.tsx'), 'utf8');
  assert(!fileContent.includes('wss://mainnet.helius-rpc.com'), 'PnLPage must not connect direct WebSocket logsSubscribe');
  assert(fileContent.includes('lastTransportMessageAt'), 'PnLPage must track transport message timestamps');
  assert(fileContent.includes('lastDataEventAt'), 'PnLPage must track data event timestamps');
  assert(fileContent.includes('lastHeartbeatAt'), 'PnLPage must track heartbeat timestamps');
});

// 7. Verify MarketDataManager Fallback Price Behavior
runTest('MarketDataManager returns market data unavailable on failure without cached price', () => {
  const fileContent = fs.readFileSync(path.join(process.cwd(), 'src/services/marketDataManager.ts'), 'utf8');
  assert(fileContent.includes("error: 'Market data unavailable'"), 'MarketDataManager must return unavailable error');
  assert(!fileContent.includes('...cached.price,\n          isStale: true'), 'MarketDataManager must not return old cached prices on fallback');
});

// 8. Verify RiskManager Jupiter-only Exit Authority
runTest('RiskManager enforces Jupiter as sole exit price authority', () => {
  const fileContent = fs.readFileSync(path.join(process.cwd(), 'src/services/RiskManager.ts'), 'utf8');
  assert(fileContent.includes("if (source !== 'jupiter') return;"), 'RiskManager must reject non-Jupiter sources');
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✨ All regression checks passed cleanly!\n');
}
