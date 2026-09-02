import fs from 'fs';
import path from 'path';

const checks = [
  ['strict token registry decimals', 'src/services/TokenRegistry.ts', /resolvedDecimals !== undefined/],
  ['position registry rejects unknown decimals', 'src/services/PositionRegistry.ts', /requires verified token decimals/],
  ['server PnL rejects invalid decimals', 'server/trading/PnLEngine.ts', /Invalid persisted decimals/],
  ['risk manager fail-closed decimals', 'src/services/RiskManager.ts', /Cannot evaluate position .* safely/],
  ['paper executor no unknown decimal fallback', 'src/services/PaperTradeExecutor.ts', /Unable to resolve token decimals for mint/],
  ['wallet buy concurrency lock', 'server/trading/TradingEngine.ts', /withBuyWalletLock/],
  ['auth preserves id token', 'server/middleware/auth.ts', /req\s+as any\)\.idToken/],
  ['trading config user scoped', 'server/routes/trading.ts', /fetchCriteriaFromFirestore/],
  ['worker heartbeat single flight', 'server/services/WorkerHeartbeat.ts', /running = false/],
  ['trading worker telemetry single flight', 'server/workers/tradingWorker.ts', /telemetryLoopRunning/],
];
let failed = 0;
for (const [name, file, re] of checks) {
  const fullPath = path.resolve(process.cwd(), file);
  const text = fs.readFileSync(fullPath, 'utf8');
  if (!re.test(text)) { console.error(`FAIL: ${name}`); failed++; }
  else console.log(`PASS: ${name}`);
}
console.log(`RESULT: ${checks.length - failed}/${checks.length}`);
process.exitCode = failed ? 1 : 0;
