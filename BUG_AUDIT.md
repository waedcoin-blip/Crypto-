# Arina X-Ray — Comprehensive Bug Audit & Defect Catalog

## 1. Summary of Identified Defects

| Bug ID | Severity | Component | Root Cause | Fix Summary |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-101** | CRITICAL | `RebuyGuard` | Rebuy counter was stored only in process memory (`Map`), causing limits to reset on server restart. | Reads confirmed BUY history from `TradeRepository` on check. |
| **BUG-102** | CRITICAL | `TradingEngine` / `routes/trading.ts` | Frontend setting `tradeOnlyOnce` was not passed to or enforced by backend. | Added parameter through API, `TradingEngine`, and `RebuyGuard`. |
| **BUG-103** | HIGH | `OrderManager` / `PositionManager` | Restored persisted records with `wallet: 'default'` regardless of original wallet. | Persists and restores `wallet` field across repositories and managers. |
| **BUG-104** | HIGH | `TradingEngine` | `params.amountRaw || position.tokenAmount` converted `0` to full position sell. | Changed check to `params.amountRaw !== undefined`. |
| **BUG-105** | CRITICAL | `TradingEngine` | Executed BUY and SELL trades were not persisted to `TradeRepository`. | Calls `tradeRepository.recordTrade()` upon confirmed execution. |

---

## 2. Classification & Severity Breakdown

### Critical Severity (2)
- **BUG-101:** Rebuy limit bypass across server restarts.
- **BUG-102:** Unenforced `tradeOnlyOnce` setting allowing unintended repeated trades.
- **BUG-105:** Missing persistence for executed trades, breaking historical ledgers and restart recovery.

### High Severity (2)
- **BUG-103:** Loss of wallet isolation upon server restart.
- **BUG-104:** Unintended full-position liquidation when passing `amountRaw: 0`.

---

## 3. Verification & Invariants

All bugs have been fixed and verified with regression static tests (`scripts/critical-regression-static.mjs`) and the V90.23 refactored architecture test suite (`scripts/refactored-architecture-v90-23-test.mjs`).
