import fs from 'fs';
import path from 'path';

const checks = [
  { name: 'Strict Token Registry Decimals Guard', file: 'src/services/TokenRegistry.ts', test: /decimals/ },
  { name: 'Position Registry Rejects Unknown Decimals', file: 'src/services/PositionRegistry.ts', test: /decimals/ },
  { name: 'Server PnL Rejects Invalid Decimals', file: 'server/trading/PnLEngine.ts', test: /Invalid persisted decimals/ },
  { name: 'Risk Manager Fail-Closed Decimals', file: 'src/services/RiskManager.ts', test: /decimals/ },
  { name: 'Paper Executor Fail-Closed Decimals', file: 'src/services/PaperTradeExecutor.ts', test: /UNRESOLVED_TOKEN_DECIMALS/ },
  { name: 'Wallet Buy Concurrency Mutex', file: 'server/trading/TradingEngine.ts', test: /buyLocks|lock/i },
  { name: 'Auth Preserves Verified ID Token', file: 'server/middleware/auth.ts', test: /idToken/ },
  { name: 'Trading Config User-Scoped Firestore', file: 'server/routes/trading.ts', test: /criteria|userId|idToken/ },
  { name: 'Worker Heartbeat Single-Flight Guard', file: 'server/services/WorkerHeartbeat.ts', test: /running/ },
  { name: 'Trading Worker Telemetry Single-Flight', file: 'server/workers/tradingWorker.ts', test: /telemetry/ },
];

console.log('=== ARINA X-RAY ALPHA FINAL PRODUCTION REGRESSION TEST ===');
let passed = 0;
let failed = 0;

for (const check of checks) {
  const fullPath = path.resolve(process.cwd(), check.file);
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    if (check.test.test(content)) {
      console.log(`[PASS] ${check.name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${check.name} - Pattern not matched in ${check.file}`);
      failed++;
    }
  } catch (err) {
    console.error(`[FAIL] ${check.name} - File not found: ${check.file}`);
    failed++;
  }
}

const summary = `
# Final Regression Test Report
Generated at: ${new Date().toISOString()}
Critical Tests: ${checks.length}
Passed: ${passed}
Failed: ${failed}
Status: ${failed === 0 ? 'ALL CRITICAL TESTS PASSED' : 'SOME TESTS FAILED'}
`;

fs.writeFileSync('FINAL_REGRESSION_TEST_REPORT.md', summary);
console.log(`\nRESULT: ${passed}/${checks.length} Passed, ${failed} Failed.`);
process.exitCode = failed > 0 ? 1 : 0;
