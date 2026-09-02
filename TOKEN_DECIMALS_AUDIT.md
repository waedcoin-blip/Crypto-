# Token Decimals Resolution Audit (Arina X-Ray)

## 1. Executive Summary
This audit investigates the root cause of decimal resolution failures (such as `UNRESOLVED_TOKEN_DECIMALS` for mint `HmaHhC9vBh43gZnNTUFGNGP1A72jH1MXKjhHRWw2Ja8F` / FAMI) and establishes an authoritative, on-chain Solana mint account decoding pipeline that supports both SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) and Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) programs.

## 2. Root Cause Analysis
- **Reliance on External APIs**: Previously, decimal resolution relied heavily on optional AppStore state, local cache, or external third-party APIs (Jupiter Token API, DexScreener) which could fail, time out, or omit tokens that are newly listed on-chain (e.g., pump.fun or newly deployed tokens).
- **Inadequate RPC Mint Parsing**: The previous RPC fallback used `getParsedAccountInfo`, which occasionally failed or returned unparsed raw account data for certain custom or newer mint accounts.
- **Silent Fallbacks & Guessing**: Fallbacks occasionally defaulted to `6` or `9`, risking quantity corruption or throwing generic `UNRESOLVED_TOKEN_DECIMALS` errors without structured diagnostic information (such as RPC error type, providers attempted, or invalid mint status).

## 3. Scope of Impact
- Affects BUY execution, SELL execution, rebuys, wallet balance conversions, Take Profit (TP), and Stop Loss (SL) triggers.
- Quantities computed via floating-point arithmetic instead of exact BigInt integer representation.
