# ARINA X-RAY ALPHA — TESTING & AUDIT GUIDE

## Running the Automated Test Suite

```bash
# Run full automated regression test suite
npm run test
```

### Test Suite Components
1. **Production Audit Script**: `node scripts/final-production-audit.mjs`
   - Audits single exit authority, BigInt accounting, entry locks, and security invariants.
2. **Production Regression Suite**: `node scripts/final-production-regression-test.mjs`
   - E2E paper trading, candidate enrichment, criteria evaluation, and position management.
3. **Refactored Architecture Test**: `tsx scripts/refactored-architecture-v90-23-test.mjs`
   - End-to-end pipeline verification from discovery to exit execution.
4. **Helius WSS Transport Suite**: `tsx scripts/helius-wss-regression-test.ts`
   - Verifies WebSocket connection lifecycle, heartbeat ping/pong, rate limit (429) backoff, signature confirmation, and event deduplication.
5. **Raw Precision Test**: `node scripts/raw-precision-regression-test.mjs`
   - Verifies raw amount calculations and BigInt conversions.

## Additional Specialized Test Scripts
```bash
# Test E2E Paper Lifecycle
npm run test:e2e-paper

# Test Helius WSS / LaserStream
npm run test:helius-wss

# Test Single Exit Authority
npm run test:single-exit-authority

# Test Quote Safety & Slippage Guards
npm run test:quote-safety
```
