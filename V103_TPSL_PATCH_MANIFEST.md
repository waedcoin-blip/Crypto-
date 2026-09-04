# ARINA X-RAY V103 TP/SL + Precision Patch

Fixes:
- Automatic TP/SL exits require a fresh executable Jupiter quote; WSS/bonding prices are trigger candidates only.
- TradingMonitorWorker is reconciliation-only and no longer provides a second TP/SL execution pipeline.
- Failed/ambiguous exit retries move positions to RECOVERY_REQUIRED instead of blindly reopening them.
- PositionManager rejects raw token quantities above Number.MAX_SAFE_INTEGER instead of silently corrupting them.
- Position accumulation uses BigInt for intermediate raw-amount arithmetic and rejects overflow into the legacy number execution API.
- TP/SL values are validated at position creation/update.
- PnLPage no longer constructs a second PositionExitManager instance and no longer reconstructs raw token amounts using floating point for manual exits.
- FastExitExecutor rejects unsafe/non-positive raw amounts.
- Added V103 TP/SL boundary/precision regression test.

Validation: global tsc was attempted, but node_modules are not installed in this environment. Existing dependency/type errors remain; no new errors were observed in the modified server files beyond missing NodeJS/dependency types.
