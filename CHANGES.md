# Entry/Exit Consolidation — Changes

## Goal
Eliminate the client-side (browser) auto-trading pipeline that bypassed the
server's gated EntryEngine, so that paper buys can only be authorized by the
server after passing Gates 1-8.

## server/routes/trading.ts
- Removed `POST /api/trading/buy` entirely.
- `EntryEngine` already calls `tradingEngine.buy()` as a direct in-process
  function call after Gates 1-8 pass — it never needed an HTTP endpoint.
- `POST /api/trading/sell` is unchanged (legitimate `MANUAL` exit path, not
  triggered by anything autonomous).
- Do not re-add `/buy` — doing so reopens an ungated paper-buy bypass.

## src/App.tsx
Removed every path that let the browser autonomously (or manually) trigger a
paper buy:

1. **`MONITORING LOOP 2: ENTRIES`** — a 500ms client-side loop that ranked
   candidates via `opportunityScoreEngine` and called `executeAutoTrade`.
   Removed; the exit-monitoring/PnL-display half of that same effect (loop 1)
   was left intact since it's read-only display, not an exit authority.
2. **Bonding-curve migration scanner** — a second, separate autonomous buy
   trigger (`isMassiveStrength` check → `executeAutoTrade`). Removed.
3. **`executeAutoTrade` / `handleManualBuy`** — function bodies deleted
   entirely.
4. **"Paste address → auto-buy" deep link path** — now shows a notification
   instead of buying.
5. **Three manual "Buy" buttons** (candidate table, gem card, high-profit
   alert modal) — `onClick` now shows a notification explaining buys must
   pass the server gate pipeline, instead of executing a raw buy.
6. Removed now-unused imports: `EntryGate`, `OpportunityScoreEngine`,
   `orderManager` (client), `verifyHardenedScannerCriteria`.

**Left untouched:** `executeAutoSell` / `executePartialSell`
(`riskManager.requestExit` → `POST /api/trading/sell`) — this is the
sanctioned `MANUAL` exit path; nothing autonomous calls it.

## Verified
- Diffed against the original upload — the change set touches only the lines
  listed above (see diff below), nothing else was altered.
- Brace-balance check confirms no structural breakage introduced by the edits
  (matches the original file's own pre-existing paren-count quirk exactly).

## NOT verified (no network access in this environment)
- `npm install`, `npm run build`, `tsc --noEmit`, or the test suite were not
  run. Please run `npm run build && npm test` before deploying.

## Known residual item (not fixed, flagged for later)
- `src/services/TradeManager.ts` still exposes a generic `.swap()` /
  `.batchSwap()` method that would hit a buy path if ever called. Nothing in
  the app currently calls it (confirmed via grep), but it's dead capability
  worth removing in a future cleanup pass.
