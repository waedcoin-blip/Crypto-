# Remaining Bugs Patch Report

## Patch scope
This patch hardens the previously patched Arina X-Ray Alpha codebase against the remaining identified correctness, capital-safety, multi-user configuration, decimal, and async-loop issues.

## Fixes applied

1. **Frontend decimal fallbacks removed**
   - PnL position mapping no longer assumes 6 decimals.
   - Quote-validation raw amount construction fails closed when decimals are unavailable.
   - Exit-manager registration requires valid decimals.
   - App auto-sell no longer fabricates raw quantities from an assumed decimal count.

2. **TokenRegistry no longer invents decimals**
   - New records may only carry verified decimals.
   - Invalid decimal values are rejected.
   - Unknown decimals remain absent instead of becoming `6`.

3. **PositionRegistry no longer defaults decimals**
   - Opening a position requires integer decimals in the 0..18 range.

4. **RiskManager fails closed on unknown decimals**
   - Removed the final `?? 6` safety violation.
   - Invalid/missing decimals now stop position evaluation rather than risking quantity corruption.

5. **Paper execution decimal resolution hardened**
   - Unknown token decimals now throw `UNRESOLVED_TOKEN_DECIMALS`.
   - Price-quote fallback no longer invents six decimals.
   - Pump-token suffix is not treated as proof of a six-decimal mint.

6. **Server BUY max-position concurrency hardened**
   - Added a per-network/per-wallet in-process BUY mutex.
   - Concurrent BUY requests for different mints can no longer race through the local max-position check.
   - Lock cleanup is performed after completion.
   - This is process-local; distributed deployments still require a transactional/distributed lock or database constraint.

7. **Authenticated user criteria isolation completed for `/api/trading/config`**
   - Trading config GET/PUT/POST now uses the authenticated user's Firebase criteria state instead of the global JSON `CriteriaRepository`.
   - Auth middleware preserves the verified ID token for the criteria service.

8. **Async worker loops made single-flight**
   - Worker heartbeat no longer overlaps async executions.
   - Trading-worker telemetry synchronization no longer overlaps async executions.

9. **Mainnet token balance precision guard**
   - Token raw balances are accumulated as `BigInt` and rejected if they exceed JavaScript's safe integer range instead of silently corrupting quantities.

## Validation
- Remaining-production regression checks: **10/10 PASS**.
- TypeScript parser diagnostics for all modified TS/TSX files: **0 syntax errors**.
- Full dependency install/build was not executed because the environment did not have the project's npm dependencies available and registry installation was unavailable/timed out.
- No live mainnet transaction was submitted by this patch process.

## Remaining architectural requirement
For true multi-instance production deployment, replace local JSON persistence and in-process locks/reservations with a transactional shared database and distributed locking/idempotency constraints. The LaserStream ingestion layer is also still process-global and should be made user/session scoped if multiple independent users must control separate streams.
