# ARINA X-RAY ALPHA — TRADING ENGINE ARCHITECTURE

## Core Components

### 1. Ingestion & Candidate Registry
- `TokenDiscovery`: Listens to `MarketEventBus` and registers new tokens in `CandidateRegistry`.
- `CandidateRegistry`: Tracks candidate eligibility, enforces cool-down periods, and prevents duplicate buy attempts.

### 2. Candidate Enrichment
- `CandidateEnricher`: Fetches token security metadata, liquidity, market cap, pair addresses, and DEX information with automatic fallback to DexScreener/Jupiter APIs.

### 3. Hardened Criteria Engine
- `HardenedCriteriaEngine`: Evaluates security rules (mint validity, decimals, liquidity, market cap, dev ownership, top 10 holders, rug safety). Issues time-limited `HardenedApproval` tokens for passed candidates.

### 4. Laserstream Signal Engine
- `LaserstreamSignalEngine`: Applies technical analysis indicators (RSI, SMA, volume spikes, price momentum) to produce BUY/HOLD signals with dynamic TP/SL levels.

### 5. Entry Engine & Trading Engine
- `EntryEngine`: Coordinates enrichment, criteria checks, TA signal validation, atomic lock acquisition, and buy execution.
- `TradingEngine`: Single authoritative endpoint for BUY and SELL execution. Manages order state via `OrderManager` and wallet balances via `PaperWalletLedger`.

### 6. Position Management & Valuation
- `PositionManager`: Tracks open and closed positions in-memory and persists them to `PositionRepository`.
- `PositionValuationEngine`: Calculates real-time market value, executable value, and unrealized PnL per position using `BigInt` raw token units.

### 7. Unified Exit Engine
- `UnifiedExitEngine`: Sole server-side exit authority. Periodically evaluated by `ActivePositionMarketFeed` for Take-Profit (TP), Stop-Loss (SL), Trailing Stop, Max Hold Time, and Manual exit requests. Exits are executed via `FastExitExecutor`.
