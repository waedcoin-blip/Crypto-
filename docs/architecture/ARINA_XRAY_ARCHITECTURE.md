# ARINA X-RAY Trading Engine Architecture

## 1. System Overview & Core Philosophy

ARINA X-RAY is a deterministic, low-latency, multi-network Solana algorithmic trading system built for high-throughput execution, precise risk management, and fail-closed safety.

The architecture strictly adheres to the principle of **Single Sources of Truth**: every subsystem, domain state, and operational boundary has exactly one authoritative owner. The client-side application (`src/`) operates strictly as a read/control surface; all market monitoring, valuation calculations, risk evaluation, and order execution are authoritative on the server (`server/`).

---

## 2. End-to-End Trading Lifecycle Pipeline

The system processes real-time on-chain events and executes trades through a deterministic, linear pipeline:

```text
┌────────────────────────────────────────────────────────┐
│     Helius WSS / LaserStream / Yellowstone gRPC        │
└───────────────────────────┬────────────────────────────┘
                            │ (accountUpdate, slot, logs, swap)
                            ▼
┌────────────────────────────────────────────────────────┐
│              ActivePositionMarketFeed                  │
│  - Tracks candidate prices from on-chain events        │
│  - Normalizes prices across DEXs (Raydium, Pump, etc.) │
│  - Polling fallback for active position health         │
└───────────────────────────┬────────────────────────────┘
                            │ (updateFromMarketEvent)
                            ▼
┌────────────────────────────────────────────────────────┐
│              PositionValuationEngine                   │
│  - Authoritative PnL Calculation (Market & Executable) │
│  - Stale price detection (<5000ms threshold)           │
│  - In-flight request deduplication                     │
└───────────────────────────┬────────────────────────────┘
                            │ (evaluateAndExecuteExit)
                            ▼
┌────────────────────────────────────────────────────────┐
│                 UnifiedExitEngine                      │
│  - Sole Authority for TP, SL, Trailing Stop, Manual    │
│  - Atomic exit locks (per-position mutex)              │
│  - Requires fresh executable Jupiter quote             │
│  - Validates raw token balance & slippage              │
└───────────────────────────┬────────────────────────────┘
                            │ (executeSell)
                            ▼
┌────────────────────────────────────────────────────────┐
│                 FastExitExecutor                       │
│  - Creates Order via OrderManager                      │
│  - Dispatches to Paper / Devnet / Mainnet Executor     │
│  - Exponential backoff retry (up to 3 attempts)        │
└───────────────────────────┬────────────────────────────┘
                            │ (confirmed sell signature)
                            ▼
┌────────────────────────────────────────────────────────┐
│                 PositionManager                        │
│  - Updates position status to 'CLOSED'                 │
│  - Records realized PnL and exit signature             │
│  - Cleans up active valuation & feed subscriptions     │
└───────────────────────────┬────────────────────────────┘
                            │ (recordTrade)
                            ▼
┌────────────────────────────────────────────────────────┐
│                 TradeRepository                        │
│  - Persistent storage of trade history                 │
│  - RebuyGuard cleanup and telemetry propagation        │
└────────────────────────────────────────────────────────┘
```

---

## 3. Canonical Domain Owners & Single Sources of Truth

| Domain / Responsibility | Authoritative Component | Location | Description |
| :--- | :--- | :--- | :--- |
| **Exit Authority** | `UnifiedExitEngine` | `server/trading/UnifiedExitEngine.ts` | The ONLY component allowed to trigger or execute position exits (TP, SL, Trailing, Max Hold, Manual). |
| **Position Valuation & PnL** | `PositionValuationEngine` | `server/trading/PositionValuationEngine.ts` | Computes live market and executable PnL. Prevents stale calculations and deduplicates async quote calls. |
| **Market Data Streaming** | `ActivePositionMarketFeed` | `server/market/ActivePositionMarketFeed.ts` | Ingests WSS/LaserStream events, tracks mint prices, and feeds price ticks to Valuation and Exit engines. |
| **Position State & Lifecycle** | `PositionManager` | `server/trading/PositionManager.ts` | Authoritative in-memory registry and repository synchronizer for all open and closed positions. |
| **Order Management** | `OrderManager` | `server/trading/OrderManager.ts` | Tracks order states (`CREATED` -> `SUBMITTED` -> `CONFIRMING` -> `FILLED` / `RECOVERY_REQUIRED`). |
| **Execution Dispatch** | `ExecutionGateway` | `server/execution/ExecutionGateway.ts` | Routes buy/sell quotes and executions to `PaperTradeExecutor`, `DevnetTradeExecutor`, or `MainnetTradeExecutor`. |
| **Rebuy Protection** | `RebuyGuard` | `server/trading/RebuyGuard.ts` | Atomic reservation mutex ensuring strict enforcement of `maxRebuyTimes` and `tradeOnlyOnce`. |
| **Trade History Persistence** | `TradeRepository` | `server/repositories/TradeRepository.ts` | In-memory and disk persistence of all executed trades. |

---

## 4. Client / Server Boundary Rules

1. **Frontend (`src/`)**:
   - Strictly visualization, telemetry, and user input controls.
   - Does NOT run competing exit monitors, background bots in React `useEffect`, or duplicate quote loops.
   - Synchronizes state with backend via `/api/trading/positions` and `/api/trading/trades`.
   - Sends manual actions via `/api/trading/buy`, `/api/trading/sell`, and `/api/trading/positions/tpsl`.

2. **Backend (`server/`)**:
   - Runs the entire automated trading loop independently of whether a browser is connected.
   - Reconciles open positions on startup (`StartupReconciliationWorker`).
   - Maintains continuous WebSocket connections and failover RPC endpoints.

---

## 5. Fail-Closed Safety & Risk Management

- **Token Decimals Guard**: If token decimals cannot be determined or verified, the engine fails closed (`UNRESOLVED_TOKEN_DECIMALS`) and refuses to open or quote positions.
- **Atomic Exit Locks**: Prevents double-sell race conditions when simultaneous price ticks cross TP or SL thresholds.
- **Fresh Executable Quote Verification**: Before executing an exit, `UnifiedExitEngine` requires a fresh executable quote (<5000ms old) to ensure the net SOL proceeds actually satisfy the TP/SL threshold under real market liquidity.
- **Ambiguous Transaction Protection**: If a sell order is broadcast to the Solana network but confirmation times out, the position enters `RECOVERY_REQUIRED` rather than `FAILED`, preventing duplicate sell attempts.
- **Raw Amount Validation**: All internal calculations preserve integer token base units (BigInt/raw units), completely avoiding JavaScript floating-point rounding errors on micro-cap or high-supply tokens.
