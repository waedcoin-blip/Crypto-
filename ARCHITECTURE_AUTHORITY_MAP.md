# ARINA X-RAY — ARCHITECTURE AUTHORITY MAP

## 1. Boundary & Authority Matrix

| Component | Execution Tier | Authority Role | Permitted Actions | Prohibited Actions |
| :--- | :--- | :--- | :--- | :--- |
| **`HardenedCriteriaEngine`** | Server-Side | Authoritative Entry Evaluation | Evaluates candidate criteria, generates single-use approvals | Executing trades, placing orders directly |
| **`HardenedApprovalStore`** | Server-Side | Approval Lifecycle Management | Issues, validates, and consumes `HardenedApproval` tokens | Bypassing criteria checks |
| **`ExecutionEngine`** | Server-Side | Trade Execution Authority | Dispatches on-chain buy/sell transactions | Executing buys without valid `HardenedApproval` |
| **`TradingEngine`** | Server-Side | Central Orchestrator | Coordinates buy/sell flows, interacts with `PositionManager` | Frontend execution |
| **`PositionManager`** | Server-Side | Position & Balance Authority | Tracks active positions, maintains raw BigInt balances | Updating positions on unconfirmed quotes |
| **`UnifiedExitEngine`** | Server-Side | Authoritative Exit Engine | Evaluates TP/SL, triggers pre-sell checks, dispatches sell orders | Delegating exit decisions to frontend UI |
| **`JupiterPreSellValidator`** | Server-Side | Pre-Sell Validation | Validates executable quotes from Jupiter prior to sell dispatch | Executing sell if quote fails or deviates |
| **`CandidateRegistry`** | Server-Side | Market Candidate State | Stores candidate records using `MarketIdentity` (`chain:mint:pool`) | Allowing concurrent buys on same candidate |
| **`apiClient`** | Client-Side | Authenticated HTTP Client | Attaches ID token, manages refresh retry on 401 | Executing trades client-side |
| **`PnLPage` / UI** | Client-Side | Display Consumer | Renders state from `/api/trading/*` endpoints | Making autonomous entry or exit decisions |

---

## 2. Structural Separation Rule
- **Server Tier (`/server/*`)**: Owns all trading state, private keys, wallet signatures, criteria validation, and Jupiter execution.
- **Client Tier (`/src/*`)**: Functions purely as a view layer and API client consumer.
