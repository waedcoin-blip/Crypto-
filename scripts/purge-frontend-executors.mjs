// scripts/purge-frontend-executors.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Files that contain the competing frontend execution engine
const FILES_TO_DELETE = [
  'src/services/tradingEngine.ts',
  'src/services/MainnetJupiterExecutor.ts',
  'src/services/PaperTradeExecutor.ts',
  'src/services/ExecutionEngine.ts',
  'src/services/MasterMonitorService.ts',
  'src/services/PositionExitManager.ts',
  'src/services/JupiterTransactionReplay.ts',
  'src/services/SolanaTransactionService.ts',
  'src/services/BalanceService.ts',
  'src/services/WalletBalanceService.ts',
  'src/services/StartupReconciliation.ts',
  'src/utils/pnlCalculator.ts',
  'src/services/ITradeExecutor.ts',
  'src/services/ExecutionAuthority.ts',
];

console.log('🧹 Starting Frontend Execution Purge...\n');

let deletedCount = 0;
let skippedCount = 0;

for (const relPath of FILES_TO_DELETE) {
  const fullPath = path.join(rootDir, relPath);
  
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log(`✅ DELETED: ${relPath}`);
      deletedCount++;
    } catch (err) {
      console.error(`❌ FAILED to delete ${relPath}:`, err.message);
    }
  } else {
    console.log(`⏭️  SKIPPED (not found): ${relPath}`);
    skippedCount++;
  }
}

console.log(`\n🎉 Purge complete! Deleted ${deletedCount} files. Skipped ${skippedCount} files.`);
console.log('⚠️  REMINDER: You must now update your React components to use the new hooks:');
console.log('   - useTradingActions (for buy/sell)');
console.log('   - usePositions (for portfolio/positions)');
console.log('   - useSupervisor (for lifecycle/SSE)');
