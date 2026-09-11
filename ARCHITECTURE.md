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