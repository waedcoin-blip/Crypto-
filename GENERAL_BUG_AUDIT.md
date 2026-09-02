# Arina X-Ray Alpha — Bug Audit (Pass 1, Static Review)

## Scope & honesty note

This sandbox has **no network access**, so `npm install` / `npm run build` /
`npm run typecheck` / the test scripts could not actually be executed —
`node_modules` isn't present and can't be fetched. Everything below is a
**static source-code audit**: real file/line evidence, traced by hand across
the actual call graph, not assumptions from file names or comments.

Given the size of the repo (156+ TS files, a React frontend, an Express
server, and a separate worker process), this pass focused on the
highest-money-risk paths first: cross-process state, mainnet execution,
confirmation handling, and rebuy/idempotency — not a line-by-line pass of
all 156 files. I'd rather hand you a few *proven* bugs than a padded list of
42 checklist sections with guessed content.

BUILD: NOT RUN (no network/`node_modules` in this environment)
TYPECHECK: NOT RUN
TESTS: NOT RUN

---

## BUG-001 — CRITICAL: Cross-process "split-brain" JSON persistence

**Files:** `server/db/jsonStore.ts`, `server/repositories/PositionRepository.ts`
(same pattern in `OrderRepository.ts`, `TradeRepository.ts`, `CriteriaRepository.ts`)

**Root cause:**
- `package.json` builds and runs **two separate OS processes**: the web
  server (`dist/server.cjs`, serves `server/routes/trading.ts`) and the
  trading worker (`dist/worker.cjs`, built from `server/workers/tradingWorker.ts`).
- Both processes import `positionRepository` (and the other repos), which are
  **singletons that load `positions.json` into an in-memory `Map` exactly
  once, in the constructor** (`PositionRepository.load()`).
- Every write (`upsertPosition`, `updatePosition`, `closePosition`) calls
  `save()`, which does `writeDataFile(FILE_NAME, Array.from(this.positions.values()))`
  — i.e. it dumps the **entire in-memory map**, not just the changed record.
- `writeDataFile` is a plain `fs.writeFileSync` with no locking, no
  read-before-write merge, and no atomic rename (`server/db/jsonStore.ts`).

**Why this matters:** the worker process runs `TradingMonitorWorker` (TP/SL
exits) and the web server process handles manual buy/sell from the API —
both write to the same `positions.json` from two independent, never-synced
in-memory copies. Whichever process saves last **overwrites the other
process's changes wholesale**.

**Reproduction (traced, not run):**
1. Server process handles a manual `SELL` for position `P1`, updates its
   in-memory map, writes `positions.json` (P1 = CLOSED).
2. A split second earlier, the worker process's TP/SL loop had already
   loaded the old `positions.json` at startup with `P1 = OPEN` and is still
   holding that stale copy in memory.
3. Worker's monitor loop updates `P1.currentPriceSOL` (unrelated field) and
   calls `save()` — this rewrites `positions.json` with the **worker's
   stale `OPEN` copy of P1**, silently reverting the sale that was just
   confirmed on-chain.
4. Now the database says `P1` is `OPEN` even though it was already sold.
   Startup reconciliation won't catch this until the app restarts, and in
   the meantime TP/SL logic may try to sell a position that no longer
   exists on-chain (SPL balance = 0), or the UI shows a live position with
   stale price data.

**Impact:** phantom open positions, resurrected closed positions, lost
rebuy counters, incorrect PnL history, and (worst case) a second SELL
attempt against a position that's already fully exited. This is exactly the
"lost update" / check-then-act failure the audit brief asks about in
sections 17 and 29 — it's real here, not hypothetical, because the process
split is baked into the build scripts.

**Suggested fix direction (not applied yet — see note below):** either (a)
move all position/order/trade mutation into one process and have the other
talk to it over IPC/HTTP, or (b) replace the whole-file last-writer-wins
store with per-record file locking + read-merge-write, or a real embedded
DB (SQLite via better-sqlite3/WAL mode) that supports safe multi-process
access. Patching `writeDataFile` alone isn't enough — the deeper problem is
two independent in-memory caches with no synchronization.

---

## BUG-002 — HIGH: Transaction-confirmation timeout is treated as a definite failure, enabling duplicate spends

**File:** `server/execution/MainnetTradeExecutor.ts`, `buy()` and `sell()`
(same shape in both)

```ts
const txid = await this.connection.sendRawTransaction(rawTransaction, {
  skipPreflight: true,
  maxRetries: 2,
});
const confirmation = await this.connection.confirmTransaction(txid, 'confirmed');
...
} catch (e: any) {
  return { success: false, ..., error: `MAINNET_EXECUTION_ERROR: ${e?.message || e}` };
}
```

**Root cause:** `sendRawTransaction` has already broadcast the transaction
before `confirmTransaction` is awaited. `confirmTransaction(signature)`
(the single-arg overload, without a blockhash/`lastValidBlockHeight`
strategy) is the deprecated form and can throw on RPC timeout/rate-limit
even when the transaction **later lands on-chain**. Any exception here
lands in the `catch` block, which unconditionally returns `success: false`.

**Trace into the caller:**
- `OrderManager.executeOrder()` marks the order `FAILED` on `!result.success`.
- `TradingEngine.buyUnlocked()` sees `!execResult.success` and calls
  `rebuyGuard.releaseBuy(reservation.reservationId)` — freeing the
  `network:wallet:mint` slot for another buy attempt.
- Nothing here persists the broadcast `txid` anywhere before/during the
  await, so even `StartupReconciliationWorker` — which only reconciles
  orders that reached `SUBMITTED`/`CONFIRMING` with a `signature` on
  record — has no signature to check for this case, since `order.signature`
  is only set on `result.success` in `OrderManager.executeOrder`.

**Impact:** a slow-but-successful mainnet confirmation gets recorded as a
failed buy, the reservation is released, and a retry (manual click, or an
automated rebuy) spends SOL a second time for the same mint — real funds
lost, not just a data-consistency issue. This directly matches the "loss
of funds" / "duplicate transaction" criteria the brief calls CRITICAL.

**Suggested fix direction:** persist the signature to the order record
*immediately after* `sendRawTransaction` succeeds (before awaiting
confirmation), use the blockhash + `lastValidBlockHeight` confirmation
strategy so genuine expiry is distinguishable from an RPC hiccup, and on
any confirmation exception mark the order `UNKNOWN`/`RECOVERY_REQUIRED`
(not `FAILED`) so reconciliation — run right away, not just at startup —
checks the chain before releasing the rebuy reservation.

---

## BUG-003 — LOW (dead code / landmine): `ExecutionGateway`'s own `buy`/`sell`/`getBalance`/`getTokenBalance` route on the wrong field and default to paper trading

**File:** `server/execution/ExecutionGateway.ts`

```ts
async buy(params: ExecuteParams): Promise<ExecutionResult> {
  const net = params.walletAddress?.startsWith('devnet') ? 'devnet'
    : params.walletAddress?.startsWith('mainnet') ? 'mainnet' : 'paper';
  return this.getExecutor(net).buy(params);
}
```

This picks the network from `params.walletAddress`'s string prefix instead
of an explicit `network` field, and silently falls back to **paper
trading** for anything that doesn't match. The actual trading path
(`OrderManager.executeOrder`) correctly calls
`executionGateway.getExecutor(order.network).buy(...)` instead, so I could
not find any current caller of this buggy method — grepped the whole repo
for `executionGateway.buy(` / `.sell(` / `.getBalance(` / `.getTokenBalance(`
and found none outside this file. So today it's unreachable dead code, not
an active bug.

**Why it's still worth fixing:** it's exactly the kind of "duplicate/
conflicting implementation" the brief's section 3 asks about — a second,
subtly wrong routing path sitting right next to the correct one. If
anything gets refactored to call `executionGateway.buy()` directly (a
natural-looking thing to do, since it implements the same `TradeExecutor`
interface), it will silently downgrade mainnet/devnet trades to paper
trades with no error. Recommend either deleting these four methods or
fixing them to key off `params.network` like `getExecutor` does.

---

## Other things noticed but not yet fully chased down (flagging, not confirmed as bugs)

- `positionRepository.save()` does `.slice(-500)` before writing — old
  position records beyond the most recent 500 are silently dropped from
  the file on every save. Worth confirming nothing else expects full
  history from this file (e.g. PnL reporting) before treating this as safe.
- `MainnetTradeExecutor.buy()`'s `effectivePriceSol` divides by
  `(outAmountRaw / 10 ** params.decimals)` with no zero-guard — a quote
  with `outAmount = "0"` would produce `Infinity` rather than being
  rejected earlier. Didn't trace whether `quoteSafety.ts` already prevents
  a zero-output quote from reaching this point — needs a follow-up look.
- Multiple `Number(quoteRes.outAmount)` / `Number(res.value.amount)`
  conversions on raw on-chain amounts (`MainnetTradeExecutor.ts`,
  `getTokenBalance`) — safe for realistic SPL supplies but worth a
  deliberate BigInt pass if any supported token can exceed
  `Number.MAX_SAFE_INTEGER` in raw units.

---

## What I did *not* do (so you know what's still open)

- Did not run build/typecheck/tests (no network in this sandbox).
- Did not audit the frontend (`src/`) — there's a **parallel, largely
  duplicate set of services** under `src/services/` and `src/domains/`
  (e.g. `src/services/RealTradeExecutor.ts`,
  `src/services/MainnetJupiterExecutor.ts` alongside
  `server/execution/MainnetTradeExecutor.ts`). I haven't yet established
  which of these are live vs. legacy/dead — that's the section-3 "duplicate
  implementation" sweep and it looks like it needs one, given how many
  *_REPORT.md / *_PATCH.md files already exist in the repo root from past
  audit passes.
- Did not do the wallet-isolation, API-auth, secrets-in-logs, or
  WebSocket sections yet.

I didn't want to hand you a "42/42 sections, all PASS" report that's mostly
guesses — that's worse than useless for a trading app. If you want, I can
go deeper on any of: (1) the frontend duplicate-service sweep, (2) actually
patching BUG-001/002/003 with regression tests (I can write and run pure
Node test scripts here even without the full app installed), or (3)
continuing the checklist into auth/secrets/websocket. Which would be most
useful first?
