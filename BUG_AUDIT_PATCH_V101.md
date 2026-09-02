# Arina X-Ray — Bug Audit & Patch Report (v101)

## Scope
A static production-oriented audit was performed on the supplied v100+ codebase, focusing on trading correctness, persistence/restart behavior, rebuy enforcement, wallet isolation, and order lifecycle.

## Confirmed bugs

### BUG-101 — Rebuy counter was process-memory only
**Severity: CRITICAL**

`server/trading/RebuyGuard.ts` stored completed BUY counts only in an in-memory `Map`. A server/worker restart reset the counter, allowing previously exhausted rebuy limits to be bypassed.

**Patch:** rebuy checks now read confirmed BUY history from `TradeRepository` and use the in-memory counter only as a fast-path.

### BUG-102 — `tradeOnlyOnce` was not enforced server-side
**Severity: CRITICAL**

The UI has a `tradeOnlyOnce` policy, but `/api/trading/buy` did not forward it to `TradingEngine`, and the server guard had no corresponding parameter. The server therefore defaulted to its own rebuy policy.

**Patch:** the API now accepts `tradeOnlyOnce`, passes it to `TradingEngine`, and `RebuyGuard` enforces a one-total-BUY limit when enabled.

### BUG-103 — Wallet identity was lost after restart
**Severity: HIGH**

`OrderManager` and `PositionManager` loaded persisted records with `wallet: 'default'` regardless of the wallet used when the record was created. This can cause incorrect position/order ownership after restart when multiple wallet identities are used.

**Patch:** wallet is persisted in position/order/trade records and restored on startup. Legacy records without a wallet remain compatible by falling back to `default`.

### BUG-104 — Explicit SELL amount of zero was silently converted to full-position SELL
**Severity: HIGH**

`params.amountRaw || position.tokenAmount` treats `0` as absent. A caller intending to sell zero units could therefore trigger a full-position sell.

**Patch:** changed to an explicit `undefined` check. The API layer can still reject zero as invalid input if desired, but it will no longer be interpreted as "sell all."

### BUG-105 — Successful BUY/SELL executions were not recorded by the server trading engine
**Severity: CRITICAL**

`TradeRepository` existed, but the central `TradingEngine` did not persist successful BUY/SELL executions. This made restart-safe historical enforcement impossible and left the authoritative trade ledger incomplete.

**Patch:** successful BUY and SELL operations are now recorded immediately after position/order success, including network, wallet, order/position IDs, raw amount, token amount, SOL amount, price, signature, and confirmation status.

## Additional finding not changed in this patch

### BUG-106 — Raw token amounts are represented as JavaScript `number`
**Severity: HIGH / architectural**

Several execution and position models use `number` for raw token units. JavaScript numbers lose integer precision above `Number.MAX_SAFE_INTEGER`. Solana token raw quantities can exceed this boundary.

This should be the next patch: migrate raw quantities to `bigint` or canonical decimal strings at all execution/repository boundaries, with conversion to UI numbers only at presentation boundaries.

## Verification

- TypeScript parser/type-check pass could not be completed because the ZIP did not contain installed `node_modules` and the dependency install timed out in this environment.
- A targeted TypeScript syntax check of the modified files produced no syntax/type diagnostics attributable to the patch after dependency-resolution errors were filtered.
- Added dependency-free regression invariant test:
  `node scripts/critical-regression-static.mjs`
- The project already contains extensive regression suites; they should be run after a clean `npm ci` in CI/Render.

## Deployment recommendation

Do **not** enable unrestricted mainnet trading until:
1. a clean `npm ci` succeeds,
2. the full existing regression suite passes,
3. the raw-unit `number` → `bigint/string` migration is completed,
4. restart/recovery tests are run with real persisted BUY/SELL records.
