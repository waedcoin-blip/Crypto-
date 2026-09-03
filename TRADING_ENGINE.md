# ARINA X-RAY — TRADING ENGINE ARCHITECTURE & SPECIFICATION

This document outlines the architecture, data flows, safety controls, and execution state machine of the ARINA X-RAY Solana trading engine.

---

## 1. BUY Flow Pipeline
1. **Pre-Trade Risk Checks**: Verifies token mint address, liquidity concentration, mint/freeze authorities, holder distribution, and maximum price impact limit (default ≤10%).
2. **Quote Acquisition**: Requests fresh quote from Jupiter API (`getJupiterQuote`) via `httpFetch`.
3. **Quote Safety Validation**: Checks `inAmount > 0`, `outAmount > 0`, non-empty `routePlan`, and validates price impact.
4. **Transaction Construction**: Obtains serialized swap transaction from Jupiter swap endpoint.
5. **Wallet Signature**: Signs versioned transaction using user's active wallet/keypair.
6. **Broadcast**: Submits raw transaction to RPC pool with controlled sequential retry.
7. **Confirmation**: Polls `getSignatureStatus(sig, { searchTransactionHistory: true })` until `confirmed` or `finalized`.
8. **On-Chain Balance Sync**: Refreshes on-chain SPL token balance after confirmed success before updating application state.

---

## 2. SELL Flow Pipeline (Manual, Partial, Full & Auto Sell)
All sell triggers (Take-Profit, Stop-Loss, Manual Sell, Partial Sell, Auto-Sell) route through the unified Single Exit Authority pipeline:
1. **On-Chain Balance Verification**: Retrieves actual on-chain balance via `getTokenBalanceRaw`. Throws `TOKEN_BALANCE_LOOKUP_FAILED` if RPC fails (never assumes 0 balance).
2. **Decimal Resolution**: Resolves SPL mint decimals using `getTokenDecimals` or cached verified mint info. Throws `TOKEN_DECIMALS_RESOLUTION_FAILED` if unresolvable.
3. **BigInt Raw Calculation**: Calculates exact raw sell token lamports using native BigInt integer arithmetic (`percentOfRawAmount`).
4. **Fresh Executable Quote**: Requests real-time Jupiter exit quote (Token → SOL).
5. **Quote Verification**: Asserts valid `outAmount` and price impact within safety limits.
6. **Swap & Sign**: Builds versioned transaction and signs with wallet keypair.
7. **Broadcast & Signature Polling**: Submits transaction and polls signature status on-chain.
8. **Position Update**: Position state is updated or closed ONLY after on-chain signature confirmation.

---

## 3. Order State Machine
The trading engine enforces a deterministic state machine per (wallet + token + action):
- `IDLE` → Initial state.
- `QUOTING` → Fetching Jupiter quote.
- `BUILDING` → Constructing versioned swap transaction.
- `SIGNING` → Requesting wallet signature.
- `SUBMITTING` → Broadcasting transaction to RPC pool.
- `CONFIRMING` → Polling on-chain signature status.
- `CONFIRMED` → Execution finalized on-chain; balance & position updated.
- `FAILED` / `TIMEOUT` → Execution aborted; lock released safely in `finally` block.

---

## 4. Safety Controls & Protection Guards
- **No Global Scope Interception**: All HTTP traffic uses the application-level `httpFetch` client; `window.fetch` and `globalThis.fetch` remain unpatched native browser methods.
- **Fail-Closed Decimals**: Rejects fallback guess values (no blind 6 or 9 decimal defaults).
- **BigInt Amount Guard**: Prevents floating point truncation errors on large supply tokens up to 100 Trillion units.
- **Strict Network Isolation**: Live trading and paper trading environments are strictly separated. Live trade failures never fall back to simulated success.
- **Duplicate Execution Lock**: Locks active trades by `action:wallet:mint` key to prevent concurrent duplicate orders.
