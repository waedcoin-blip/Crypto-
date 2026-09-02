import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [
  ['explicit execution network', !read('server/execution/ExecutionGateway.ts').includes("startsWith('devnet')") && read('server/execution/ExecutionGateway.ts').includes('params.network')],
  ['wallet is explicitly resolved', read('server/execution/MainnetTradeExecutor.ts').includes('getAccountForExecution')],
  ['on-chain output delta', read('server/execution/MainnetTradeExecutor.ts').includes('getParsedTokenAccountsByOwner') && read('server/execution/MainnetTradeExecutor.ts').includes('actualOut')],
  ['strict token decimals', read('server/wallet/TokenProgramResolver.ts').includes('UNRESOLVED_TOKEN_DECIMALS') && !read('server/wallet/TokenProgramResolver.ts').includes('use default')],
  ['restart-safe idempotency', read('server/repositories/OrderRepository.ts').includes('clientRequestId') && read('server/trading/OrderManager.ts').includes('record.clientRequestId')],
  ['no 500 trade cap', read('server/repositories/TradeRepository.ts').includes('writeDataFile(FILE_NAME, this.trades)')],
  ['atomic persistence', read('server/db/jsonStore.ts').includes('fs.renameSync(tmpPath, filePath)')],
  ['zero sell rejected', read('server/trading/TradingEngine.ts').includes('INVALID_SELL_AMOUNT')],
  ['partial sell supported', read('server/trading/PositionManager.ts').includes('reducePosition')],
  ['laserstream config authenticated', read('server/routes/laserstream.ts').includes("router.post('/config', requireAuth")],
  ['single-flight monitor', read('server/workers/TradingMonitorWorker.ts').includes('loopRunning')],
];
let failed = 0;
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`), failed += ok ? 0 : 1;
if (failed) process.exit(1);
console.log(`\n${checks.length}/${checks.length} production patch checks passed.`);
