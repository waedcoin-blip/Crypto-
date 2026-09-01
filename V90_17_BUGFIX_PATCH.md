# v90 (17) Bug-Fix Patch

## Scope
This patch fixes verified LaserStream watchdog defects found in the uploaded v90 (17) source tree.

### Fixed defects
1. `setDisconnected()` previously assigned `status = disconnected` before health evaluation, which could suppress the transition listener and reconnect handler.
2. A transport could remain `degraded` indefinitely after prolonged total silence.
3. `reset()` did not clear the v98 ingestion diagnostic counters.
4. `setDisabled()` did not accept the provider denial message used by the regression test and had inconsistent state-transition behavior.
5. Stale warnings could be emitted on every watchdog tick.

## New health lifecycle
- `< 60 seconds` without activity: normal connected behavior.
- `> 60 seconds`: `degraded`, with transport retained.
- `> 180 seconds`: forced `disconnected`, which activates the normal reconnect path.
- Explicit transport failure: immediate `disconnected` and one reconnect attempt.
- Fatal provider plan/auth errors: `disabled`, with no reconnect loop.

## Modified files
- `server/services/LaserStreamWatchdog.ts`
- `scripts/laserstream-regression-test.ts`

## Regression coverage
The revised test verifies:
- no false `connected` state before transport confirmation;
- quiet streams become `degraded` without reconnecting;
- prolonged silence becomes `disconnected` and invokes reconnect once;
- explicit `setDisconnected()` invokes reconnect once;
- fatal provider denial remains `disabled`;
- every ingestion diagnostic counter is cleared by `reset()`.

## Run
After dependencies are installed:

```bash
npm ci
npm run lint
npm run test:laserstream
npm run test:parity
npm run test:jupiter-replay
npm run test:tpsl-pipeline
npm run test:tp-sl-raw-balance
npm run test:single-exit-authority
npm run test:jupiter-only
npm run test:token-age-gate
npm run test:rpc-ws-routing
```

## Important limitation
The patch package was created in an environment without the project's `node_modules`, so the regression command could not be executed here. The source-level regression tests are included and should be run after a clean dependency installation.
