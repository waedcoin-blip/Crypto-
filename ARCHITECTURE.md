# ARINA X-RAY — ARCHITECTURE & DESIGN DOCUMENT

## Executive Overview
ARINA X-RAY is a high-frequency Solana algorithmic trading platform built with React, Node.js, Express, and Firebase. This document outlines the consolidated production architecture designed for maximum performance, multi-network safety, raw SPL precision, and single sources of truth across all trading and monitoring paths.

---

## Architecture Principles

### 1. Single Sources of Truth
- **Trading Engine (`src/services/tradingEngine.ts`)**: Central entry point for all buy, sell, partial sell, and full sell requests across paper and mainnet execution.
- **Jupiter Service (`src/services/jupiterService.ts`)**: Unified client for quotes, swap transaction creation, quote validation, and price impact safety checks.
- **RPC Service (`src/services/rpcService.ts`)**: Single connection pool and RPC routing manager for on-chain queries, balance checks, and transaction submissions.
- **Token Service (`src/services/tokenService.ts`)**: Central manager for token metadata, on-chain mint validation, and decimal resolution via `TokenDecimalsResolver`.
- **Amount Engine (`src/utils/amounts.ts`)**: Authoritative engine for raw BigInt SPL token math, decimal conversions, percentage calculations, and display formatting.
- **Transaction Service (`src/services/transactionService.ts`)**: Single pipeline for transaction signing, RPC broadcasting, and confirmation polling.
- **Market Data Service (`src/services/marketDataManager.ts`)**: Deduplicated, batched market data provider with circuit breakers and short-lived tier caching.

---

## Directory Structure

```
src/
├── components/          # Modular React UI components & pages
├── config/              # Network & trading configuration
├── constants/           # Solana system constants
├── context/             # React context providers
├── hooks/               # Custom React hooks
├── lib/                 # Shared encryption & utilities
├── services/            # Clean single-responsibility service layer
│   ├── httpClient.ts          # Unpatched native fetch wrapper
│   ├── jupiterService.ts      # Unified Jupiter client
│   ├── marketDataManager.ts   # Centralized market data manager
│   ├── OrderManager.ts        # Order queue & execution router
│   ├── PositionExitManager.ts # Risk & exit proxy manager
│   ├── PositionRegistry.ts    # Central position state store
│   ├── RiskManager.ts         # Risk rules & automated exit engine
│   ├── rpcHealthManager.ts    # RPC health monitoring
│   ├── rpcRouting.ts          # Role-based RPC endpoint configuration
│   ├── rpcService.ts          # Unified RPC connection pool & web3 methods
│   ├── tokenService.ts        # Token metadata & balance resolution
│   ├── TokenDecimalsResolver.ts # On-chain & registry token decimal resolver
│   ├── TokenRegistry.ts       # Verified token mint registry
│   ├── TradeManager.ts        # Trade mode adapter
│   ├── tradingEngine.ts       # Single trading engine interface
│   ├── transactionService.ts  # Transaction signing & submission service
│   └── WalletBalanceService.ts # Wallet balance synchronization
├── store/               # Zustand application state stores
├── types/               # Shared TypeScript interfaces & types
└── utils/               # Precision math, amounts, keypair, & PnL calculators
    ├── amounts.ts             # BigInt raw SPL amount & decimal math
    ├── keypairUtils.ts        # Session keypair manager
    ├── pnlCalculator.ts       # Net PnL, gas, and fee calculation engine
    └── quoteSafety.ts         # Jupiter quote safety & diagnostic validator
```

---

## Core System Pipelines

### Trading Pipeline
```
[UI / Automated Monitors]
       │
       ▼
[src/services/tradingEngine.ts]
       │
       ├──────────────► [OrderManager]
       │                       │
       │                       ▼
       ├──────────────► [RebuyGuard Check]
       │                       │
       │                       ▼
       ├──────────────► [Jupiter Quote & Safety Validation]
       │                       │
       │                       ▼
       └──────────────► [TransactionService & RPC Pool]
                               │
                               ▼
                        [Solana Mainnet / Paper Engine]
```

---

## Key Safety & Precision Invariants

1. **Native Fetch Protocol**: Native `globalThis.fetch` is never patched or overridden.
2. **BigInt Precision**: Raw SPL token amounts are strictly maintained as `bigint` without IEEE 754 precision loss.
3. **Decimals Verification**: Trades are rejected if token decimals cannot be verified on-chain or through the verified token registry.
4. **Mainnet Keypair Isolation**: Mainnet trades strictly require an explicitly configured private key and active wallet signature.

---

## Testing & Verification
The platform includes an automated regression and audit test suite executed via:
```bash
npm test
```
The test suite verifies:
- Multi-wallet & multi-network isolation
- RebuyGuard atomic mutex reservations
- Position lifecycle & BigInt accumulation
- Authoritative PnL calculation accuracy
- On-chain quote safety and decimal verification
