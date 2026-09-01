# v90 (18) Complete Fix Patch

## Fixed

1. **Wallet transaction ownership validation**
   - Removed the unsafe `postTokenBalances[0]` assumption.
   - Aggregates pre/post raw token balances only where `owner === monitored wallet`.
   - Ignores wrapped SOL when selecting the copied-token delta.

2. **No fabricated transaction amounts**
   - Removed wallet-monitor fallback amounts based on `Math.random()`.
   - Unparseable or zero-amount transactions are ignored and logged.

3. **Wallet signature deduplication**
   - Adds a dedicated per-wallet signature registry before RPC parsing.
   - Prevents duplicate asynchronous `onLogs` callbacks from racing React state updates.

4. **Persistent synchronization log**
   - Writes verified wallet events to Firestore `walletTransactions` using a deterministic document ID.
   - Stores wallet ID/address/label, signature, side, token, amount, timestamp and sync time.

5. **Pulse Feed attribution**
   - Every monitored-wallet alert now includes the wallet label/address.
   - Trade records retain the monitored wallet as `fromAccount`.

6. **Master Monitor RPC authority**
   - `MasterMonitorService` now honors an explicitly supplied RPC endpoint before falling back to role routing.

7. **Duplicate source trees removed from production package**
   - `v98audit/` and `v101audit/` were removed from the corrected source tree.
   - Do not restore these nested application copies into production.

8. **Regression test added**
   - `npm run test:wallet-monitor`
   - Tests exact owner matching, correct delta calculation, rejection of another wallet's balance, and no fabricated trade.

## Validation

The wallet regression command was attempted, but this environment does not contain the project's local `tsx` executable (`tsx: not found`). Therefore it was not claimed as passed. Install dependencies from the project lockfile and run:

```bash
npm ci
npm run test:wallet-monitor
npm run lint
npm run build
npm run test:laserstream
npm run test:parity
npm run test:jupiter-replay
```

## Operational result

A saved trader wallet is now expected to follow:

`subscription -> signature -> dedupe -> transaction fetch -> exact owner validation -> raw balance delta -> Pulse Feed -> Firestore sync log`.
