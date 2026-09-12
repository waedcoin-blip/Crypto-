# ARINA X-RAY ALPHA — SYSTEM ARCHITECTURE

## Overview
Arina X-Ray Alpha is a high-frequency Solana paper-trading and live-monitoring application built with TypeScript, Node.js (Express), React (Vite), and Tailwind CSS.

## Subsystem Architecture & Data Pipeline

```
[ Data Sources ] (Pump.fun WS/HTTP, DexScreener, Helius WSS / LaserStream)
        │
        ▼
[ Ingestion & Discovery ] (TokenDiscovery, LaserStreamPipeline)
        │
        ▼
[ Event Normalization ] (OnChainEventNormalizer, CanonicalEventNormalizer)
        │
        ▼
[ Candidate Registry ] (CandidateRegistry - Eligibility & Dedup)
        │
        ▼
[ Candidate Enrichment ] (CandidateEnricher - Market Data & Security Metadata)
        │
        ▼
[ Hardened Criteria Engine ] (Gate 1 Security & Market Filters → HardenedApproval)
        │
        ▼
[ Laserstream Signal Engine ] (Gate 2 Technical Analysis & Momentum Evaluation)
        │
        ▼
[ Server Entry Gate / Entry Engine ] (Atomic Locks & Buy Authorization)
        │
        ▼
[ Trading Engine & Executors ] (TradingEngine → PaperTradeExecutor / Live Executor)
        │
        ▼
[ Position Management ] (PositionManager & PositionRepository)
        │
        ▼
[ Active Position Market Feed ] (ActivePositionMarketFeed - Ingests real-time prices for open positions)
        │
        ▼
[ Position Valuation Engine ] (PositionValuationEngine - Real-time valuation & raw BigInt accounting)
        │
        ▼
[ PnL Calculation Engine ] (PnLEngine - Realized & Unrealized PnL metrics)
        │
        ▼
[ Unified Exit Engine ] (Sole Authoritative Exit Engine - TP/SL/Trailing/MaxHold/Manual)
        │
        ▼
[ Fast Exit Executor ] (FastExitExecutor & Signature Confirmation)
```

## Key System Invariants
1. **Single Entry Authority**: All automated buys pass through `EntryEngine` and `HardenedCriteriaEngine`. Manual buys route through `TradingEngine.buy()`.
2. **Single Exit Authority**: `UnifiedExitEngine` is the sole server-side authority for evaluating and executing position exits.
3. **BigInt Accounting**: Raw token amounts are stored and processed as exact `BigInt` strings to eliminate floating-point precision loss.
4. **Independent Active Position Feeds**: Open positions receive real-time market value updates regardless of whether `TradingSupervisor` is set to `TRADING` or `PAUSED`.
5. **No Key Exposure**: API keys and secrets are handled exclusively on the backend server (`server.ts` / `/api/*`).
