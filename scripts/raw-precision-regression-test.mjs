import assert from 'node:assert/strict';
import fs from 'node:fs';

// Source-level regression guard. The runtime test suite requires the project's TS loader;
// this test intentionally remains dependency-free so it can run in a clean checkout.
const paper = fs.readFileSync('server/execution/PaperTradeExecutor.ts', 'utf8');
const fastExit = fs.readFileSync('server/execution/FastExitExecutor.ts', 'utf8');
const pos = fs.readFileSync('server/trading/PositionManager.ts', 'utf8');
const ledger = fs.readFileSync('server/wallet/PaperWalletLedger.ts', 'utf8');
const trading = fs.readFileSync('server/trading/TradingEngine.ts', 'utf8');

assert(!/Number\(amountRaw\)/.test(paper));
assert(!/Number\(rawBig\)/.test(fastExit));
assert(/getTokenBalanceRaw/.test(paper));
assert(/tokenAmountRaw \|\| String\(pos\.tokenAmount\)/.test(pos));
assert(/amountRaw:/.test(trading));
assert(/if \(sold > currentToken\)/.test(ledger));
assert(/INSUFFICIENT_TOKEN_BALANCE/.test(paper));

console.log('[PASS] Raw amount precision and paper-balance fail-closed guards');
