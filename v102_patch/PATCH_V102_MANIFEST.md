# ARINA X-RAY v102 Security / Precision Patch

## Fixed
- Protected pipeline ingress/evaluation endpoints with Firebase auth.
- Protected LaserStream configuration changes with Firebase auth.
- Added strict event source/timestamp validation at pipeline ingress.
- Prevented lossy raw SPL amount aggregation with BigInt.
- Sent raw Jupiter quote amounts as exact decimal strings and refuse unsafe integer conversion.
- Fixed Safety page to require `isRugSafe === true`.
- Fixed zero-sell momentum handling.
- Corrected Prediction page to stop claiming unavailable social/news APIs are live.
- Added authenticated frontend requests for protected pipeline/manual sell endpoints.
- Removed per-mount construction of a second PositionExitManager proxy in PnLPage.

## Validation
Run:
`node scripts/patch-v102-security-precision-regression.mjs`
`npm run lint`
`npm run build`
`npm test`

## Important
The patch is fail-closed for raw amounts above JavaScript's safe integer range in the legacy `ITradeExecutor` number-based interface. This is intentional: it prevents quantity corruption. A future interface revision can make raw amounts `bigint|string` end-to-end.
