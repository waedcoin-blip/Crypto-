# ARINA X-RAY ALPHA — REGRESSION TEST SUITE DOCUMENTATION

## Automated Regression Tests

The regression test suite validates system invariants across key modules:

### 1. Architectural & Safety Invariants (`scripts/final-production-audit.mjs`)
- Validates single exit authority (`UnifiedExitEngine`).
- Validates atomic evaluation entry locks.
- Validates fail-closed state transitions.

### 2. End-to-End Paper Lifecycle (`scripts/final-production-regression-test.mjs` & `scripts/e2e-paper-lifecycle-test.ts`)
- Mocks live candidate discovery, enrichment, hardened security checks, TA momentum evaluation, order execution, position tracking, active market price feeding, and exit execution.

### 3. Helius WSS & Streaming Transport (`scripts/helius-wss-regression-test.ts`)
- Mocks a local WSS server.
- Verifies subscription lifecycle (`slotSubscribe`, `logsSubscribe`, `accountSubscribe`).
- Verifies heartbeat ping/pong, 120s staleness reconnect, duplicate slot deduplication, and HTTP 429 rate limit backoff.

### 4. BigInt Accounting & Raw Amount Precision (`scripts/raw-precision-regression-test.mjs`)
- Tests parsing and formatting of 6, 8, 9, and 18-decimal tokens.
- Verifies that raw balances match UI representation without loss of precision.

### Running All Tests
```bash
npm run test
```
