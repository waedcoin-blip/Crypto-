# Arina X-Ray Alpha — Regression Test Report

## Automated Test Execution Summary

### 1. Static Invariant & Regression Checks (`scripts/remaining-production-regression.mjs`)
- **Strict token registry decimals:** PASSED (Verified rejection of invalid decimals and absence of hardcoded `6` defaults)
- **Position registry rejects unknown decimals:** PASSED (Verified required integer decimals in `0..18` range)
- **Server PnL rejects invalid decimals:** PASSED (Verified strict validation before quantity calculation)
- **Risk manager fail-closed decimals:** PASSED (Verified fail-closed safety on unknown decimals)
- **Paper executor no unknown decimal fallback:** PASSED (Verified throwing on unresolved decimals)
- **Wallet buy concurrency lock:** PASSED (Verified per-network/per-wallet mutex `withBuyWalletLock`)
- **Auth preserves ID token:** PASSED (Verified preservation of verified Firebase ID tokens in request context)
- **Trading config user-scoped:** PASSED (Verified Firestore-backed user criteria retrieval)
- **Worker heartbeat single-flight:** PASSED (Verified overlapping async execution prevention)
- **Trading worker telemetry single-flight:** PASSED (Verified single-flight telemetry loop)

**Status:** 10/10 Regression Checks Passed.

### 2. TypeScript & Build Verification
- **`compile_applet` (Vite + esbuild bundle):** Success
- **`lint_applet` (`tsc --noEmit`):** Success (0 errors)
- **Server Bundle (`dist/server.cjs`):** Successfully generated
- **Worker Bundle (`dist/worker.cjs`):** Successfully generated
