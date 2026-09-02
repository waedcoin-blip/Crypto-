import fs from 'node:fs';
const resolver = fs.readFileSync('src/services/TokenDecimalsResolver.ts','utf8');
const server = fs.readFileSync('server/wallet/TokenProgramResolver.ts','utf8');
const checks = [
  ['client uses RPC endpoint list', resolver.includes("rpcRouting.getRpcEndpoints('search')")],
  ['client does not use pump 6 fallback', !resolver.includes("program: 'PumpFallback'") && !resolver.includes('if (this.isPumpMint(cleanMint)) {')],
  ['client sync resolver fails closed', resolver.includes('No verified decimals available')],
  ['server has execution backup', server.includes('EXECUTION_RPC_BACKUP_URL')],
  ['server has search backup', server.includes('SEARCH_RPC_BACKUP_URL')],
  ['server fails closed', server.includes('TOKEN_DECIMALS_RESOLUTION_FAILED')],
  ['server validates token program', server.includes('TOKEN_PROGRAM_UNSUPPORTED')],
];
let ok=true; for (const [n,p] of checks) { console.log(`${p?'PASS':'FAIL'}: ${n}`); ok &&= p; }
process.exit(ok?0:1);
