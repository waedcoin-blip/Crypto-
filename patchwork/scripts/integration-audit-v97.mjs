import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const ingest = read('server/engines/LaserstreamIngestion.ts');
const watchdog = read('server/services/LaserStreamWatchdog.ts');
const pnl = read('src/components/pages/PnLPage.tsx');

console.log('Running v97 static integration audit...');
assert.match(ingest, /state\.transportConnected\s*=\s*true;[\s\S]{0,500}setTransportState\(true/, 'Subscription success must mark transport connected immediately');
assert.match(watchdog, /activityStaleMs:\s*(60000|LASERSTREAM_ACTIVITY_STALE_MS)/, 'Watchdog observation threshold must be 60 seconds');
assert.match(watchdog, /marking degraded|newStatus = 'degraded'/, 'Quiet stream must degrade rather than disconnect');
assert.match(ingest, /network:\s*['\"]?mainnet|LaserStreamNetwork/, 'LaserStream must retain explicit network handling');
assert.match(pnl, /lastReceivedSlot/, 'PnL telemetry must surface receive-slot diagnostics');
assert.ok(!/lower\.includes\(['\"]business['\"]\)/.test(ingest), 'Broad business error matching must not return');
console.log('✓ subscription establishes transport state');
console.log('✓ quiet stream uses 60s degraded policy');
console.log('✓ receive-slot telemetry is present');
console.log('✓ broad permanent-error classification is absent');
console.log('v97 static integration audit passed.');
