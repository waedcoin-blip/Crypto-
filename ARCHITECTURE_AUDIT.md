# ARINA X-RAY Comprehensive Architecture Audit

## 1. Executive Summary

This architecture audit inventories all trading, discovery, evaluation, execution, and monitoring components in the ARINA X-RAY codebase. It documents duplicate implementations, competing authorities, race conditions, stale-state risks, security bypasses, and historical patches, and establishes the blueprint for the unified, fail-closed architecture.

---

## 2. Inventory of Trading Engines & Authorities

### 2.1 Buy & Discovery Pipeline
- **Candidate Ingestion**:
  - `server/market/CanonicalEventNormalizer.ts`: Normalizes raw events into `UnifiedMarketEvent`.
  - `server/market/EventNormalizer.ts`: Legacy normalizer with overlapping schemas.
  - `server/market/OnChainEventNormalizer.ts`: On-chain DEX transaction parser.
  - `server/market/CandidateRegistry.ts`: In-memory registry for tokens discovered from Pulse Feed, LaserStream, Helius WSS, Pump.fun, DexScreener.
- **Candidate Evaluation**:
  - `server/trading/CandidateEnricher.ts`: Enriches candidates with liquidity, supply, and token decimals.
  - `server/trading/OpportunityScorer.ts`: Heuristic scoring (0-100).
  - `server/trading/ServerEntryGate.ts`: 12-point gate validation.
  - `server/services/criteriaService.ts` & `server/repositories/CriteriaRepository.ts`: Criteria configuration persistence.
- **Buy Execution**:
  - `server/trading/EntryEngine.ts`: Automated pipeline connecting discovery -> enrichment -> scoring -> gate -> execution.
  - `server/trading/TradingEngine.ts`: Central entrypoint for `buy()` and `sell()`.
  - `server/trading/OrderManager.ts`: State machine for order lifecycle (`CREATED` -> `SUBMITTED` -> `CONFIRMING` -> `FILLED` / `RECOVERY_REQUIRED`).
  - `server/execution/ExecutionGateway.ts`: Dispatches to `PaperTradeExecutor`, `DevnetTradeExecutor`, or `MainnetTradeExecutor`.

### 2.2 Exit & Valuation Pipeline
- **Market Data Feed**:
  - `server/market/ActivePositionMarketFeed.ts`: Live streaming ingestion for active positions with fallback polling.
- **Valuation & PnL**:
  - `server/trading/PositionValuationEngine.ts`: Authoritative PnL calculator (market value and executable quote).
  - `server/trading/PnLEngine.ts`: Duplicate older PnL calculations.
  - `src/services/PositionPnLEngine.ts`: Client-side duplicate PnL engine.
- **Exit Decision & Execution**:
  - `server/trading/UnifiedExitEngine.ts`: Authoritative exit evaluator for TP, SL, Trailing Stop, Max Hold, and Manual.
  - `server/execution/FastExitExecutor.ts`: Executes sell orders via `ExecutionGateway` with retry logic.
  - `server/workers/TradingMonitorWorker.ts`: Legacy polling worker that also attempted exit evaluations.
  - `src/services/PositionExitManager.ts` & `src/services/ExitTriggerEngine.ts`: Client-side exit managers.

---

## 3. Competing Authorities & Duplicate Systems

| Domain | Competing Implementations | Authoritative Component | Migration Action |
| :--- | :--- | :--- | :--- |
| **Exit Authority** | `UnifiedExitEngine`, `TradingMonitorWorker`, `PositionExitManager`, `ExitTriggerEngine` | `UnifiedExitEngine` | Deprecate client-side exit logic and disable `TradingMonitorWorker` exit loops. |
| **Position Valuation** | `PositionValuationEngine`, `PnLEngine`, `PositionPnLEngine`, `PnLPage.tsx` | `PositionValuationEngine` | Eliminate `PnLEngine` calculations; client renders server valuation directly. |
| **Criteria Engine** | `ServerEntryGate`, `OpportunityScorer`, `CriteriaService`, `unifiedBuyContract.ts` | `HardenedCriteriaEngine` | Unify into single `HardenedCriteriaEngine` returning `PASS`, `FAIL`, `UNKNOWN`, issuing `HardenedApproval`. |
| **Rebuy Guard** | `RebuyGuard.ts`, `TokenLifecycleManager.ts` (client) | `RebuyGuard.ts` | Enforce atomic state machine (`NONE -> BUY_IN_PROGRESS -> BOUGHT \| HOLD \| RELEASE`) server-side only. |
| **Order Execution** | `TradingEngine`, `FastExitExecutor`, `TradeManager` (client), `ExecutionEngine` (client) | `ExecutionGateway` via `OrderManager` | Route all buys and sells through single server execution authority. |
| **Event Normalization** | `CanonicalEventNormalizer`, `EventNormalizer`, `OnChainEventNormalizer` | `CanonicalEventNormalizer` | Consolidate all event sources to `UnifiedMarketEvent`. |

---

## 4. Identified Vulnerabilities, Race Conditions & Stale-State Risks

1. **Direct API Buy Bypass**:
   - **Vulnerability**: Calling `POST /api/trading/buy` directly executed a buy without validating `HardenedApproval` or checking criteria.
   - **Remediation**: Guard `/api/trading/buy` and `TradingEngine.buy()` with mandatory `HardenedApproval` validation.
2. **Direct API Sell Bypass**:
   - **Vulnerability**: Calling `POST /api/trading/sell` directly executed a sell without performing an `Exit Pre-Check` (liquidity, route, fresh quote, quote safety).
   - **Remediation**: Guard `/api/trading/sell` with mandatory `ExitPreCheck` verification.
3. **Unknown Transaction Status & Premature Reservation Release**:
   - **Vulnerability**: If an RPC timeout occurred during buy execution, the system could release the RebuyGuard reservation or trigger an immediate retry while the transaction was still pending on-chain, causing duplicate buys.
   - **Remediation**: Implement strict `BUY_IN_PROGRESS -> HOLD` state machine. Poll signature for 60-90s. If still unknown, transition to `BUY_STATUS_UNKNOWN`, retain `REBUY_GUARD_HELD`, and require manual reconciliation. Never auto-retry.
4. **Market Identity vs. Mint Identity Confusion**:
   - **Vulnerability**: Using global best price across pools instead of the position's specific pool price, causing false TP/SL triggers.
   - **Remediation**: Bind all candidates, positions, and valuations to explicit `MarketIdentity` (`chain:mint:pool`).
5. **Approval Re-use & Race Conditions**:
   - **Vulnerability**: Multiple concurrent buy signals for the same token could attempt execution with the same criteria decision.
   - **Remediation**: Issue single-use `HardenedApproval` with states `ISSUED -> CONSUMING -> CONSUMED`. Once `CONSUMED`, it can never be reused.
6. **RAM Leaks on Closed Positions**:
   - **Vulnerability**: Closed positions remaining in in-memory valuation and subscription maps.
   - **Remediation**: Comprehensive post-close cleanup: remove active valuation, cancel price feed subscriptions, remove consumed approvals, and purge temporary objects.

---

## 5. Final Coherent Architecture Design

1. **Ingestion & Dedup**:
   `WSS / LaserStream / Pump.fun / DexScreener`
   -> `CanonicalEventNormalizer` (`UnifiedMarketEvent`)
   -> Event Deduplication (`eventId + signature`)
   -> `CandidateRegistry` (`MintIdentity` + `MarketIdentity`)
2. **Evaluation & Approval**:
   `CandidateRegistry`
   -> Bounded Queue / In-flight Map
   -> `HardenedCriteriaEngine`
   -> (FAIL -> REJECTED [version-scoped], UNKNOWN -> PENDING_RETRY -> DEAD, PASS -> `HardenedApproval`)
3. **Execution & Guard**:
   `HardenedApproval`
   -> `Final Recheck` (slot, price deviation, criteriaVersion, criteria re-run)
   -> Atomic `RebuyGuard` (`BUY_IN_PROGRESS`)
   -> Fresh Jupiter Quote + Quote Safety
   -> `ExecutionGateway`
   -> Blockchain Confirmation / Reconciliation
   -> `PositionManager` (`BOUGHT` -> `OPEN`)
4. **Exit & Valuation**:
   `ActivePositionMarketFeed`
   -> `PositionValuationEngine` (`MarketIdentity`-bound)
   -> `UnifiedExitEngine`
   -> `Exit Pre-Check` (liquidity, route, fresh quote, raw balance)
   -> `ExecutionGateway`
   -> Blockchain Confirmation
   -> `PositionManager` (`CLOSED`)
   -> RAM Cleanup & RebuyGuard Release
