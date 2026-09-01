# v101 Integration & Trading Reliability Patch

## Scope
This patch hardens the role-isolated Solana transport architecture introduced in v100 and addresses the most critical integration gaps found in v90 (16).

## Changes

### 1. Central role connection factory
Added `src/services/roleConnectionFactory.ts`.

Services can now create a connection only by explicitly selecting one of:

- `search`
- `monitor`
- `execution`

The factory obtains the RPC and matching WS endpoint from `rpcRouting`. It does not substitute another role when an endpoint is unavailable.

### 2. Mainnet execution isolation
`MainnetJupiterExecutor` now uses the `execution` role by default. A caller-supplied RPC remains explicit rather than silently falling back to Search or Monitor.

### 3. Wallet balance routing
`WalletBalanceService` now uses the `monitor` role for non-paper wallet synchronization. Existing sequence guards continue to protect against out-of-order refresh responses.

### 4. Token metadata lookup
`PaperTradeExecutor` now uses the `search` role when it needs an on-chain mint lookup for token decimals.

### 5. RPC/WS regression command
The routing test now runs with `tsx`, matching the project's existing TypeScript test tooling.

## Important remaining audit work
The source still contains direct `new Connection()` calls outside these migrated critical paths. They were deliberately not mass-replaced because some are diagnostic, health-check, compatibility, or explicitly supplied endpoint paths that require semantic review before migration.

Before production mainnet use, migrate or explicitly document every remaining direct connection according to its role.

## Validation status
This archive was prepared from the uploaded v90 (16) source. Dependency installation could not complete within the available audit runtime, so the full lint/build/test suite was not represented as passing by this patch alone. Run the full validation suite after applying.

Required commands:

```bash
npm ci
npm run lint
npm run build
npm run test:rpc-ws-routing
npm run test:laserstream
npm run test:jupiter-replay
npm run test:parity
npm run test:tpsl-pipeline
npm run test:tp-sl-raw-balance
npm run test:single-exit-authority
npm run test:jupiter-only
npm run test:token-age-gate
```
