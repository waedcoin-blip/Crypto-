# Arina X-Ray — Regression Test Report

## Automated Test Execution Summary

### 1. Refactored Architecture Integration Test (`scripts/refactored-architecture-v90-23-test.mjs`)
- **TEST 1 (Multi-Wallet & Multi-Network Isolation):** PASSED
- **TEST 2 (RebuyGuard Atomic Reservation & Release):** PASSED
- **TEST 3 (TradingEngine Centralized BUY & Position Lifecycle):** PASSED
- **TEST 4 (TradingEngine REBUY & Position Accumulation):** PASSED
- **TEST 5 (Authoritative PnLEngine Calculation):** PASSED
- **TEST 6 (TradingEngine Centralized SELL & Position Closure):** PASSED
- **TEST 7 (Yellowstone gRPC Telemetry Verification):** PASSED

### 2. Static Invariant Regression Check (`scripts/critical-regression-static.mjs`)
- **Check 1:** Persisted BUY history participation in `RebuyGuard`
- **Check 2:** Server-side `tradeOnlyOnce` propagation and enforcement
- **Check 3:** Wallet identity persistence in `PositionRepository`, `OrderRepository`, `TradeRepository`
- **Check 4:** Explicit zero SELL amount handling

**Status:** 5/5 Static Invariant Checks Passed.

### 3. Build & Lint Verification
- `compile_applet`: Success
- `lint_applet` (`tsc --noEmit`): Success (0 errors)
