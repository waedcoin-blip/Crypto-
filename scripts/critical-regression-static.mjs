import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(p, 'utf8');

const rebuy = read('server/trading/RebuyGuard.ts');
const engine = read('server/trading/TradingEngine.ts');
const positions = read('server/trading/PositionManager.ts');
const orders = read('server/trading/OrderManager.ts');
const positionRepo = read('server/repositories/PositionRepository.ts');
const orderRepo = read('server/repositories/OrderRepository.ts');
const tradeRepo = read('server/repositories/TradeRepository.ts');
const route = read('server/routes/trading.ts');

// BUG-101: persisted BUY history must participate in rebuy enforcement.
assert.match(rebuy, /tradeRepository\.getTrades\(network\)/);
assert.match(rebuy, /t\.side === 'BUY'/);
assert.match(rebuy, /t\.status === 'CONFIRMED'/);

// BUG-102: server must receive and enforce the UI's tradeOnlyOnce policy.
assert.match(route, /tradeOnlyOnce/);
assert.match(engine, /tradeOnlyOnce\?: boolean/);
assert.match(engine, /tradeOnlyOnce: params\.tradeOnlyOnce/);
assert.match(rebuy, /params\.tradeOnlyOnce \? 1 : 1 \+ maxRebuys/);

// BUG-103: wallet identity must survive persistence/restart.
assert.match(positionRepo, /wallet\?: string/);
assert.match(orderRepo, /wallet\?: string/);
assert.match(tradeRepo, /wallet\?: string/);
assert.match(positions, /wallet: record\.wallet \|\| 'default'/);
assert.match(orders, /wallet: record\.wallet \|\| 'default'/);

// BUG-104: explicit sell amount 0 must not silently become "sell full position".
assert.match(engine, /params\.amountRaw !== undefined \? params\.amountRaw : position\.tokenAmount/);

console.log('Critical regression static checks: PASS (5/5)');
