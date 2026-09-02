# ARINA X-RAY V90.23 ARCHITECTURE SPECIFICATION

## 1. System Overview & Core Philosophy
Arina X-Ray V90.23 is an automated, high-frequency Solana trading platform built for 24/7 Render worker operation.
The architecture enforces strict determinism, worker-authoritative state, single exit authority, and zero double-execution guarantees across Paper, Devnet, and Mainnet networks.

## 2. Core Architectural Principles
- **One Coordinator**: `TradingEngine` (`/server/trading/TradingEngine.ts`) is the single entry point for all BUY, SELL, REBUY, and CANCEL operations.
- **One Order Manager**: `OrderManager` (`/server/trading/OrderManager.ts`) handles order lifecycle state, persistence, and strict idempotency keying (`network:wallet:mint:side:clientRequestId`).
- **One Position Manager**: `PositionManager` (`/server/trading/PositionManager.ts`) maintains authoritative position state keyed strictly by account (`network:wallet:mint`).
- **One Rebuy Guard**: `RebuyGuard` (`/server/trading/RebuyGuard.ts`) provides atomic buy reservations, release-on-failure, and enforces `maxRebuyTimes` bounds.
- **One Exit Authority**: `RiskManager` (`/server/trading/RiskManager.ts`) owns all exit decisions (TP, SL, Trailing SL, Max Hold) and uses atomic exit locks to guarantee exactly one exit trade per position.
- **One Execution Gateway**: `ExecutionGateway` (`/server/execution/ExecutionGateway.ts`) routes requests to isolated `PaperTradeExecutor`, `DevnetTradeExecutor`, or `MainnetTradeExecutor`.
- **One Yellowstone Connection**: `YellowstoneConnectionManager` (`/server/market/YellowstoneConnectionManager.ts`) maintains a single active gRPC stream per network with auto-reconnect, slot tracking, and deduplication.

## 3. Directory Layout
```
server/
  trading/
    TradingEngine.ts           <- Central Coordinator
    OrderManager.ts            <- Single Authoritative Order Lifecycle & Idempotency Manager
    PositionManager.ts         <- Single Authoritative Position Manager & State Machine
    RebuyGuard.ts              <- Central Authoritative Rebuy Guard & Reservation Engine
    RiskManager.ts             <- Risk Management, Exit Decision & Single Exit Reservation
    PnLEngine.ts               <- Authoritative PnL Calculation Engine
  execution/
    TradeExecutor.ts           <- Core TradeExecutor interface & Quote/Execution types
    PaperTradeExecutor.ts      <- Paper Trading Execution Implementation
    DevnetTradeExecutor.ts     <- Devnet Execution (Supports Devnet Wallet A & B, Token-2022)
    MainnetTradeExecutor.ts    <- Mainnet Execution (Jupiter v6 API + on-chain verification)
    ExecutionGateway.ts        <- Gateway routing to Paper/Devnet/Mainnet executors
  market/
    YellowstoneConnectionManager.ts <- Geyser gRPC connection manager (1 per network)
    EventNormalizer.ts         <- Transforms raw gRPC messages into MarketEvent
    MarketEventBus.ts          <- Pub/sub event bus for normalized MarketEvent
    TokenDiscovery.ts          <- Safe Token Discovery (SPL/Token-2022 account checks)
  wallet/
    WalletManager.ts           <- Centralized Wallet identity & signers
    TokenProgramResolver.ts    <- Centralized SPL Token / Token-2022 program resolver
  repositories/
    OrderRepository.ts
    PositionRepository.ts
    TradeRepository.ts
    WorkerStateRepository.ts
  workers/
    tradingWorker.ts           <- Render 24/7 worker process
    StartupReconciliationWorker.ts <- Startup reconciliation on worker boot
```

## 4. Execution Flow Diagram
```
[Scanner / Signal / User UI]
           │
           ▼
    TradingEngine.buy()
           │
           ├──► RebuyGuard.reserveBuy() (Atomic check & reservation)
           │
           ├──► OrderManager.createOrder() (Generate & store order with Idempotency Key)
           │
           ├──► OrderManager.executeOrder()
           │        │
           │        ▼
           │   ExecutionGateway (Paper / Devnet / Mainnet Executor)
           │        │
           │        ▼
           │   On-Chain Transaction / Simulated Swap
           │
           ├──► [SUCCESS] ──► RebuyGuard.confirmBuy()
           │             └──► PositionManager.openOrAccumulatePosition()
           │
           └──► [FAILURE] ──► RebuyGuard.releaseBuy() (Unblocks future retry)
                         └──► OrderManager.updateOrderStatus('FAILED')
```
