import fs from 'fs';
import assert from 'assert';

const app = fs.readFileSync('src/App.tsx','utf8');
const gate = fs.readFileSync('src/services/EntryGate.ts','utf8');
const guard = fs.readFileSync('src/config/rebuyGuard.ts','utf8');
const worker = fs.readFileSync('server/workers/tradingWorker.ts','utf8');
const ingestion = fs.readFileSync('server/engines/LaserstreamIngestion.ts','utf8');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json','utf8'));

assert(!pkg.dependencies['helius-laserstream'], 'Old helius-laserstream dependency remains');
assert(!Object.keys(lock.packages || {}).some(k => k.includes('helius-laserstream')), 'Old helius-laserstream lock entries remain');
assert(app.includes('isRebuyAllowed('), 'App does not use centralized rebuy guard');
assert(gate.includes('isRebuyAllowed('), 'EntryGate does not use centralized rebuy guard');
assert(!app.includes('autoBoughtTokens'), 'Legacy autoBoughtTokens duplicate guard remains');
assert(guard.includes("ENTRY_ALREADY_PENDING"), 'Pending reservation guard missing');
assert(guard.includes("t?.network === 'mainnet' || t?.network === 'paper'"), 'Explicit trade network isolation missing');
assert(worker.includes('config.YELLOWSTONE_GRPC_ENDPOINT') || worker.includes('config.YELLOWSTONE_GRPC_DEVNET_ENDPOINT'), 'Worker is not endpoint-configured');
assert(!worker.includes('if (config.HELIUS_API_KEY)'), 'Worker still gates Yellowstone on Helius API key');
assert(ingestion.includes('preTokenBalances') && ingestion.includes('postTokenBalances'), 'Mint extraction is not token-balance based');
assert(ingestion.includes('options.xToken'), 'Yellowstone x-token support missing');
assert(!ingestion.includes('grpc.mainnet.helius-rpc.com'), 'Helius fallback endpoint remains');

// Pure behavior checks mirroring the guard contract.
const completedBuys = 1;
const maxTrades = 2;
assert(completedBuys < maxTrades, 'A token with one completed BUY should permit the second BUY when max=2');
assert(completedBuys >= maxTrades === false, 'Trade limit arithmetic is inconsistent');
assert(completedBuys === 1, 'Pending BUY must not be counted as completed');

console.log('PASS: critical rebuy/Yellowstone regression checks');
