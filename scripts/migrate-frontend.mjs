// scripts/migrate-frontend.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');

// Files to delete (frontend execution layer)
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
  'src/services/tokenScanner.ts',
];

// Collect all surviving source files to check imports
function getAllSourceFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllSourceFiles(fullPath, files);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function isImportedAnywhere(targetFile, allFiles) {
  const baseName = path.basename(targetFile).replace(/\.(ts|tsx|js|jsx)$/, '');
  for (const file of allFiles) {
    // Skip the file itself and files slated for deletion
    if (file.endsWith(targetFile)) continue;
    const content = fs.readFileSync(file, 'utf8');
    // Check for import references (by basename or path fragment)
    const importRegex = new RegExp(`from\\s+['"][^'"]*${baseName}['"]`, 'g');
    if (importRegex.test(content)) {
      return file;
    }
  }
  return null;
}

console.log('🔍 Scanning for import references before deletion...\n');

const allFiles = getAllSourceFiles(srcDir);
let deleted = 0;
let skipped = 0;
let blocked = 0;

for (const relPath of FILES_TO_DELETE) {
  const fullPath = path.join(rootDir, relPath);

  if (!fs.existsSync(fullPath)) {
    console.log(`⏭️  SKIP (not found): ${relPath}`);
    skipped++;
    continue;
  }

  // Safety check: is this file imported by any surviving file?
  const importedBy = isImportedAnywhere(relPath, allFiles.filter(f => !FILES_TO_DELETE.some(d => f.endsWith(d))));

  if (importedBy) {
    console.log(`🚫 BLOCKED: ${relPath} is still imported by ${path.relative(rootDir, importedBy)}`);
    console.log(`   → Migrate that import to the new ApiClient/hooks first, then re-run.`);
    blocked++;
    continue;
  }

  fs.unlinkSync(fullPath);
  console.log(`✅ DELETED: ${relPath}`);
  deleted++;
}

console.log(`\n📊 Summary: ${deleted} deleted, ${skipped} skipped, ${blocked} blocked`);

if (blocked > 0) {
  console.log('\n⚠️  Some files are still imported. Migrate those components to use:');
  console.log('   - src/services/ApiClient.ts (tradingApi, pipelineApi, etc.)');
  console.log('   - src/hooks/useTradingActions.ts');
  console.log('   - src/hooks/usePositions.ts');
  console.log('   - src/hooks/useSupervisor.ts');
  console.log('   - src/hooks/useCriteria.ts');
  process.exit(1);
} else {
  console.log('\n🎉 Frontend execution layer fully removed. Browser is now a pure dashboard.');
}
