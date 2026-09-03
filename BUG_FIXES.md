# ARINA X-RAY — BUG FIXES & ENGINEERING AUDIT REPORT

This report details the audit findings, root causes, engineering fixes, and verification results across the ARINA X-RAY application and Solana trading engine.

---

## 1. Window.fetch & Global Scope Interception
- **Bug**: Modifying or re-defining `window.fetch` using `Object.defineProperty(window, 'fetch', ...)` or assignment caused `TypeError: Cannot set property fetch of #<Window> which has only a getter` in modern browser environments.
- **Root Cause**: Modern browser runtimes declare `window.fetch` on `Window.prototype` as a getter-only property. Any attempt to write or redefine `window.fetch` throws a non-catchable TypeError.
- **Fix**: Removed all monkey-patching of `window.fetch` from `index.html` and codebase. Built an application-level wrapper in `src/services/httpClient.ts` (`httpFetch`) that binds to native `globalThis.fetch`.
- **Affected Files**: `/index.html`, `/src/services/httpClient.ts`, `/src/services/jupiterService.ts`, `/src/services/TokenDecimalsResolver.ts`
- **Verification**: `npm run test:fetch-global` regression test suite passed cleanly.

---

## 2. Fail-Closed Token Decimals Resolution
- **Bug**: SPL token decimal lookups previously fell back to a default `6` or `9` when RPC requests failed or returned unverified results, risking massive miscalculation of raw sell/buy amounts (10x to 1000x error).
- **Root Cause**: Unhandled exception handling in token decimal resolution defaulted to `6` rather than throwing an explicit fail-closed error.
- **Fix**: Implemented strict on-chain `getMint(...)` resolution in `getTokenDecimals`. If decimals cannot be resolved from verified SPL mint accounts or registered cache, execution throws `TOKEN_DECIMALS_RESOLUTION_FAILED` or `UNRESOLVED_TOKEN_DECIMALS` rather than applying blind fallbacks.
- **Affected Files**: `/src/services/jupiterService.ts`, `/src/services/OrderManager.ts`, `/src/services/TokenDecimalsResolver.ts`
- **Verification**: `npm run test:fami-decimals` regression test passed (verified non-fallback behavior).

---

## 3. RPC Error to Zero Balance Suppression
- **Bug**: RPC failures, network timeouts, or rate limits during token balance lookups returned `"0"` or `0`, causing auto-sell engines to misinterpret a network glitch as a zero position and abort or misfire.
- **Root Cause**: `catch { return "0"; }` pattern in balance lookup helper functions.
- **Fix**: Refactored `getTokenBalanceRaw` in `/src/services/jupiterService.ts` and auto-sell balance lookup in `/src/App.tsx` to throw explicit `TOKEN_BALANCE_LOOKUP_FAILED` / `AUTO_SELL_BALANCE_LOOKUP_FAILED` errors on RPC exceptions. Zero balance is returned ONLY when RPC lookup succeeds and returns an empty or zero token account array.
- **Affected Files**: `/src/services/jupiterService.ts`, `/src/App.tsx`
- **Verification**: Verified via test suite and auto-sell error path handling.

---

## 4. BigInt Precision for Raw SPL Token Arithmetic
- **Bug**: Raw SPL token amount calculations used `Number(balanceRaw)` and `Math.floor()`, leading to precision loss and IEEE-754 floating point truncation on large supply meme tokens (e.g. 100 Billion / Trillion tokens).
- **Root Cause**: JavaScript standard numbers lose integer precision past $2^{53} - 1$ (9,007,199,254,740,991).
- **Fix**: Converted all SPL raw token calculations and partial sell percentage calculations to native `BigInt` arithmetic via `percentOfRawAmount` (`(raw * bps) / 10000n`).
- **Affected Files**: `/src/services/jupiterService.ts`, `/src/App.tsx`, `/src/services/MainnetJupiterExecutor.ts`
- **Verification**: `npm run test:quote-safety` (Scenario 10) verified 100 Trillion BigInt raw token calculations without loss of precision.

---

## 5. Signature-Based Transaction Confirmation & Polling
- **Bug**: Transaction confirmation previously fetched a fresh `getLatestBlockhash()` and passed it into `confirmTransaction(...)` alongside a signature created with a different blockhash, causing false confirmation timeouts or rejected transactions.
- **Root Cause**: Using a blockhash other than the exact blockhash compiled into the signed transaction invalidates transaction confirmation bounds.
- **Fix**: Implemented direct signature status polling using `getSignatureStatus(sig, { searchTransactionHistory: true })` over a 90-second deadline in `MainnetJupiterExecutor.ts`. Explicitly verifies on-chain slot and error state (`confirmationStatus.err`).
- **Affected Files**: `/src/services/MainnetJupiterExecutor.ts`
- **Verification**: Confirmed via `npm run typecheck` and `compile_applet`.

---

## 6. Telegram Route Error Classification
- **Bug**: Unconfigured or invalid Telegram Bot tokens threw 502 `BadGatewayError`s and flooded backend operational logs.
- **Root Cause**: All non-200 Telegram API responses were wrapped in `BadGatewayError`.
- **Fix**: Classified client token errors (400, 401, 403, 404) as `ValidationError` and added token configuration checks to `isBenignError`. Client-provided bot tokens in `req.body.token` are prioritized over `process.env.TELEGRAM_BOT_TOKEN`.
- **Affected Files**: `/server/routes/telegram.ts`, `/server/utils/errors.ts`
- **Verification**: `lint_applet` and `compile_applet` passed cleanly.

---

## Summary of Verification Results
- **TypeScript Typecheck (`npm run lint`)**: PASS (0 errors)
- **Applet Compilation (`npm run build`)**: PASS (0 errors)
- **Global Fetch Regression Test**: PASS
- **Token Decimals Resolution Test**: PASS
- **Quote Safety & BigInt Test Suite**: PASS (10/10 scenarios)
- **Single Exit Authority Risk Pipeline Test**: PASS (5/5 checks)
