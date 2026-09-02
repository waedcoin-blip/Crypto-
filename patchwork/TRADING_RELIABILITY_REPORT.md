# Arina X-Ray — Trading Reliability Report

## Architectural & Execution Invariants

1. **Centralized Authority:**
   `TradingEngine` serves as the single entry point for all BUY and SELL actions.
2. **Atomic Reservation & Rebuy Safety:**
   `RebuyGuard` uses atomic memory reservations (`reserveBuy()`) to block concurrent duplicate BUY attempts for the same token, network, and wallet.
3. **Position Cost Basis & Average Price:**
   `PositionManager.openOrAccumulatePosition()` accurately tracks accumulated token quantity and total SOL spent, updating average entry prices without floating-point pollution.
4. **Authoritative PnL Calculation:**
   `PnLEngine` computes gross and net unrealized and realized PnL taking estimated trading fees and slippage into account.
5. **Persistence & Recovery:**
   Positions, orders, and executed trades are written to disk repositories (`/data`), surviving worker and server process restarts.
