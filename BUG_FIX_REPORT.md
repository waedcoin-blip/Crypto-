# Arina X-Ray — Bug Fix Report

## Applied Fixes Summary

### 1. Rebuy Enforcement Persistence (`server/trading/RebuyGuard.ts`)
- Modified `getCompletedBuyCount()` to query `tradeRepository` for confirmed BUY records matching network, wallet, and mint.
- Updated `canBuy()` and `reserveBuy()` to accept and enforce `tradeOnlyOnce`.

### 2. API Route Parameter Propagation (`server/routes/trading.ts`)
- Updated `POST /api/trading/buy` handler to extract `tradeOnlyOnce` from request body and pass it to `tradingEngine.buy()`.

### 3. Trade History Recording (`server/trading/TradingEngine.ts`)
- Integrated `tradeRepository.recordTrade()` into `buy()` and `sell()` routines following position update.
- Updated SELL amount parameter handling from `params.amountRaw || position.tokenAmount` to `params.amountRaw !== undefined ? params.amountRaw : position.tokenAmount`.

### 4. Wallet Identity Preservation
- Updated `PositionRepository.ts`, `OrderRepository.ts`, `TradeRepository.ts` interfaces to include optional `wallet` field.
- Updated `PositionManager.ts` and `OrderManager.ts` to rehydrate `wallet` from persisted records with fallback to `'default'`.
