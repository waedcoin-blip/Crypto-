import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = p => fs.readFileSync(path.join(root,p), 'utf8');
const checks = [
  ['no-devnet-runtime', !fs.readdirSync(root,{recursive:true}).some(p => /devnet/i.test(String(p)) && !String(p).includes('node_modules'))],
  ['gateway-balances-network-aware', /getSolBalance\(walletAddress\?: string, network/.test(read('server/execution/ExecutionGateway.ts'))],
  ['no-rebuy-six-decimal-default', !read('server/trading/TradingEngine.ts').includes('params.decimals ?? 6')],
  ['no-jupiter-precheck-for-paper', /const isMainnet/.test(read('server/execution/FastExitExecutor.ts'))],
  ['ambiguous-exit-stops-retry', /EXIT_RECOVERY_REQUIRED/.test(read('server/execution/FastExitExecutor.ts'))],
  ['raw-quote-precision', /outAmountRaw/.test(read('server/services/JupiterPreSellValidator.ts'))],
  ['live-signer-mismatch-rejected', /Refusing to sign/.test(read('server/wallet/WalletManager.ts'))],
  ['no-public-rpc-fallback', !read('server/config/rpcRouting.ts').includes("api.mainnet-beta.solana.com") && !read('server/market/TokenMetadataResolver.ts').includes("api.mainnet-beta.solana.com")],
];
let failed=0;
for (const [name, ok] of checks) { console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok) failed++; }
if(failed) process.exit(1);
console.log(`All ${checks.length} trading bugfix invariants passed.`);
