import fs from 'fs';

const checks = [
  ['pipeline auth', fs.readFileSync('server/routes/pipeline.ts','utf8').includes("router.post('/ingress', requireAuth")],
  ['pipeline evaluate auth', fs.readFileSync('server/routes/pipeline.ts','utf8').includes("router.post('/evaluate', requireAuth")],
  ['laserstream config auth', fs.readFileSync('server/routes/laserstream.ts','utf8').includes("router.post('/config', requireAuth")],
  ['exact Jupiter raw amount', fs.readFileSync('src/services/MainnetJupiterExecutor.ts','utf8').includes('amount: strAmount as any')],
  ['BigInt token aggregation', fs.readFileSync('src/services/MainnetJupiterExecutor.ts','utf8').includes('let totalRawAmount = 0n')],
  ['safety requires explicit rug safe', fs.readFileSync('src/components/pages/SafetyPage.tsx','utf8').includes('token.isRugSafe === true')],
  ['pipeline client auth', fs.readFileSync('src/engines/unifiedTradePipeline.ts','utf8').includes('authenticatedFetch')],
  ['manual sell auth', fs.readFileSync('src/services/RiskManager.ts','utf8').includes("authenticatedFetch('/api/trading/sell'")],
  ['startup reconciliation does not close at arbitrary raw dust', fs.readFileSync('src/services/StartupReconciliation.ts','utf8').includes('if (rawBalance <= 0)')],
  ['server reconciliation keeps u64 balance exact', fs.readFileSync('server/workers/StartupReconciliationWorker.ts','utf8').includes('readBigUInt64LE(64)') && fs.readFileSync('server/workers/StartupReconciliationWorker.ts','utf8').includes('rawBalance.toString()')],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); if (!ok) failed++; }
process.exit(failed ? 1 : 0);
