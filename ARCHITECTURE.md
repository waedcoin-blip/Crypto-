# ARINA X-RAY ALPHA — Architecture & Design Document

## 1. Executive Overview
ARINA X-RAY Alpha is an institutional-grade, **backend-authoritative** algorithmic trading platform for the Solana blockchain. It is engineered for high-frequency event ingestion (via Helius LaserStream/gRPC), strict risk management, and fail-closed execution safety.

**Core Architectural Paradigm:** The system enforces a strict separation of concerns where the **Node.js backend is the sole authority** for trade execution, position state, and exit logic. The React frontend operates exclusively as a telemetry dashboard and API dispatcher, eliminating browser-side race conditions, tab-sleep missed exits, and duplicate execution authorities.

---

## 2. Core Architectural Principles
1. **Backend Authority:** The frontend never constructs, signs, or broadcasts transactions directly. It delegates all trading intent to the backend `TradingEngine` and `UnifiedExitEngine`.
2. **Single-Use Hardened Approvals:** Every buy requires a cryptographically bound, single-use `HardenedApproval` token. Once consumed, it cannot be reused, preventing duplicate buys from race conditions.
3. **Executable Quote Invariant:** No exit (TP/SL/Manual) is executed based on synthetic or cached prices. Every exit requires a fresh, validated Jupiter Executable Quote (`JupiterPreSellValidator`).
4. **BigInt Raw Precision:** All token amounts and lamports are handled as `BigInt` or string representations of raw base units. IEEE-754 floating-point math is strictly forbidden in the execution path.
5. **Atomic Persistence:** Position, Order, and Trade states are persisted via `JsonStore` with atomic file writes and stale-lock recovery to prevent repository corruption during server restarts.
6. **Strict Network Isolation:** Paper, Devnet, and Mainnet execution paths are firewalled via the `ExecutionGateway`. Paper mode cannot accidentally trigger live RPC calls.

---

## 3. Directory Structure
```text
arina-x-ray/
├── server/                      # BACKEND (Authoritative Execution)
│   ├── config/                  # Zod-validated environment & trading configs
│   ├── execution/               # TradeExecutor interface, Mainnet/Paper/Devnet executors
│   ├── market/                  # Event ingestion, normalization, CandidateRegistry
│   ├── middleware/              # Auth, Rate Limiting, Error Handling
│   ├── repositories/            # Atomic JsonStore persistence layer
│   ├── routes/                  # Express API routers (trading, pipeline, health)
│   ├── trading/                 # Core engines (Trading, Exit, Criteria, PnL, Positions)
│   ├── wallet/                  # Server-side keypair management & Paper Ledger
│   └── workers/                 # Background monitoring & reconciliation
├── shared/                      # ISOMORPHIC (Types, Event Bus, Shared Detectors)
├── src/                         # FRONTEND (Pure Telemetry & UI)
│   ├── components/              # React UI (Dashboards, Tables, Charts)
│   ├── hooks/                   # usePositions, useTradingActions, useSupervisor
│   ├── services/                # ApiClient.ts (Fetch wrapper only)
│   └── store/                   # Zustand (UI state, cached telemetry)
└── scripts/                     # Regression tests & E2E lifecycle validation
```

---

## 4. The Buy Pipeline (Entry Flow)
```text
[Event Sources: LaserStream / WSS / DexScreener / Pump.fun]
       │
       ▼
[MarketEventBus] ──► [CandidateRegistry] (Dedup & State Tracking)
       │
       ▼
[CandidateEnricher] (SWR Cached DexScreener + On-Chain Metadata)
       │
       ▼
[HardenedCriteriaEngine] ──► Issues Single-Use [HardenedApproval]
       │
       ▼
[TradingEngine.buy()]
   ├── 1. Mint Validation Gate (On-chain SPL/Token-2022 check)
   ├── 2. RebuyGuard (Atomic Mutex Reservation)
   ├── 3. RiskManager (Final profitability revalidation)
   ├── 4. OrderManager (Idempotent order creation)
   └── 5. ExecutionGateway ──► [MainnetTradeExecutor] (Jupiter Swap)
              │
              ▼
       [PositionManager] (Opens/Accumulates Position)
```

---

## 5. The Exit Pipeline (TP / SL / Trailing / Manual)
```text
[ActivePositionMarketFeed] + [TradingMonitorWorker]
       │ (Live Price Updates & Periodic Valuation)
       ▼
[PositionValuationEngine] (Fetches fresh Jupiter quotes)
       │
       ▼
[UnifiedExitEngine] (Evaluates TP/SL/Trailing/MaxHold)
       │ (If triggered)
       ▼
[FastExitExecutor]
   ├── 1. JupiterPreSellValidator (Executable Quote & Price Impact check)
   ├── 2. OrderManager (Creates SELL order)
   └── 3. ExecutionGateway ──► [MainnetTradeExecutor]
              │
              ▼
       [PositionManager] (Marks CLOSED, calculates Realized PnL)
       [PnLEngine] (Updates Portfolio Metrics)
```

---

## 6. Single Sources of Truth (Authoritative Engines)

| Domain | Authoritative File | Responsibility |
| :--- | :--- | :--- |
| **Trade Execution** | `server/trading/TradingEngine.ts` | Orchestrates the buy lifecycle, locks, and approvals. |
| **Exit Authority** | `server/trading/UnifiedExitEngine.ts` | Sole owner of TP/SL evaluation and exit execution. |
| **Position State** | `server/trading/PositionManager.ts` | In-memory state synced to `PositionRepository`. |
| **PnL Math** | `server/trading/PnLEngine.ts` | Calculates unrealized/realized PnL using raw BigInt amounts. |
| **Criteria/Risk** | `server/trading/HardenedCriteriaEngine.ts` | Evaluates candidates and issues single-use approvals. |
| **Order Queue** | `server/trading/OrderManager.ts` | Idempotent order tracking and state machine. |
| **Event Bus** | `server/market/MarketEventBus.ts` | Central pub/sub for all normalized market events. |

---

## 7. Safety Invariants & Fail-Closed Guards

*   **No Synthetic Exits:** The `UnifiedExitEngine` will *never* execute a sell based on a DexScreener or WSS price. It strictly requires a successful `JupiterPreSellValidator` quote. If Jupiter is down, the exit is queued/retried, not executed blindly.
*   **Atomic Rebuy Guard:** `RebuyGuard` uses an in-memory mutex to prevent concurrent buy evaluations for the same mint/wallet from resulting in double-spend.
*   **Stale Lock Recovery:** The `JsonStore` persistence layer implements atomic file writes with stale-lock detection to prevent repository corruption during server restarts.
*   **Frontend Key Safety:** The browser holds private keys in ephemeral memory only (via `walletBridge.ts`). Keys are never persisted to `localStorage` or transmitted to the backend. For maximum safety, mainnet execution relies on the backend `WalletManager` (env-loaded keys).
*   **Memory Leak Prevention:** All singleton background intervals (`setInterval`) utilize `.unref()` to ensure the Node.js process can shut down gracefully without hanging.

---

## 8. Frontend Integration Model
The React frontend (`src/`) has been stripped of all execution authority.
*   **State:** Zustand stores (`appStore`) only hold UI preferences and cached telemetry. Position and PnL data are fetched via `usePositions` polling the backend `/api/trading/portfolio/pnl`.
*   **Actions:** Buy/Sell buttons trigger `useTradingActions`, which sends an HTTP POST to `/api/trading/buy` or `/api/trading/sell`.
*   **Real-time Data:** The frontend subscribes to `/api/laserstream/events` (Server-Sent Events) to receive live market telemetry pushed by the backend `MarketEventBus`.

---

## 9. Testing & Verification
The architecture is validated by a strict regression suite (`npm test`):
1.  **Refactored Architecture Suite:** Verifies multi-wallet isolation and RebuyGuard mutexes.
2.  **Jupiter-Only Architecture Test:** Ensures no exit bypasses the executable quote validator.
3.  **E2E Paper Lifecycle:** Simulates a full Buy -> Pump -> TP Trigger -> Sell -> Close cycle in paper mode.
4.  **Raw Precision Regression:** Validates BigInt math against IEEE-754 edge cases.
