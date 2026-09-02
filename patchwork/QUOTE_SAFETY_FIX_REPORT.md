# ARINA X-RAY — Quote Safety & 100% Price Impact Root Cause Fix Report

## 1. Executive Summary

- **Issue Reported**: `FAIL: Buy error for $1: QUOTE_SAFETY_ERROR: Excessive price impact (100.00%) exceeds safety threshold of 10.0%.`
- **Resolution**: Identified the dual root causes in price impact normalization and error classification. Implemented standard quote validation, decimal-safe BigInt conversion for USD to lamports, robust direction checks, safe diagnostic logging, and a 10-scenario regression test suite.
- **Safety Threshold Status**: Strictly preserved at **10.0% (`MAX_PRICE_IMPACT_RATIO = 0.10`)**. No safety thresholds were weakened or bypassed.

---

## 2. Root Cause Analysis

### Root Cause A: Jupiter API `priceImpactPct` Units & Double Scaling
- **Documented API Behavior**: Jupiter Quote API v6 (`/v6/quote`) and Swap API v1 (`/swap/v1/quote`) return `priceImpactPct` as a string formatted in **percentage points** (e.g., `"1.00"` for 1.00%, `"0.12"` for 0.12%, `"10.0"` for 10.0%, `"100.0"` for 100.0%).
- **The Defect**: Legacy validation functions parsed `parseFloat(quote.priceImpactPct) * 100`. When a normal quote with 1% price impact (`"1.00"`) was returned by Jupiter, the code computed `1.00 * 100 = 100.00%`. This triggered an artificial `QUOTE_SAFETY_ERROR: Excessive price impact (100.00%) exceeds safety threshold of 10.0%` on completely safe, valid buys.

### Root Cause B: Inappropriate Error Mapping for Malformed / Empty Quotes
- When quotes were empty, missing routes, or returned `null`/`undefined`/`NaN` price impact (e.g. illiquid pools or test mocks), fallback handlers defaulted the price impact to `100.00%` or threw generic safety errors.
- **Correct Behavior**: Invalid quote payloads must return `INVALID_QUOTE` or `NO_ROUTE` without misdiagnosing them as high price impact.

### Root Cause C: Floating Point Precision Loss in USD -> SOL -> Lamport Conversion
- Entering "$1" was previously susceptible to floating point rounding errors during `(1 / solPrice) * 1e9`.
- **Correct Behavior**: Converted to integer arithmetic using scaled micro-cents (`BigInt`) and exact lamport derivation.

---

## 3. Systematic Architectural Solutions Implemented

### 1. Unified `normalizePriceImpact` Engine (`src/utils/quoteSafety.ts` & `server/utils/quoteSafety.ts`)
- Unambiguous internal representation as a decimal ratio (`0.10` = 10%, `0.01` = 1%, `1.00` = 100%).
- Rigorously validates against `null`, `undefined`, `NaN`, and infinity.

### 2. Standardized Safe Diagnostics (`buildSafeQuoteDiagnostic`)
- Safely captures diagnostic parameters immediately prior to any error:
  - `requestedUsdAmount`
  - `solPriceUsed`
  - `calculatedSolAmount`
  - `calculatedLamports`
  - `inputMint` & `outputMint`
  - `rawPriceImpactPct` & `typeofPriceImpactPct`
  - `normalizedPriceImpactRatio` & `normalizedPriceImpactPct`
  - `routePlanLength`
  - `inAmount` & `outAmount`
- **Zero Secrets**: Strictly strips and prohibits private keys, seed phrases, API keys, and sensitive tokens from logs.

### 3. Strict Quote Safety Validation (`validateQuoteSafetyStrict`)
- **Positive Base Units**: Asserts `inAmount > 0` and integer representation.
- **Slippage Upper Bound**: Limits slippage to `<= 1000 BPS` (10%).
- **Empty / Malformed Detection**: Throws `INVALID_QUOTE` for null quote or zero `outAmount`.
- **Liquidity / Route Verification**: Throws `NO_ROUTE` for empty or missing `routePlan`.
- **BUY Direction Guard**: Enforces `inputMint === SOL_MINT` (`So11111111111111111111111111111111111111112`) and `outputMint === targetTokenMint`.
- **Safety Enforcement**: Compares `normalizedImpact <= MAX_PRICE_IMPACT_RATIO` (0.10).

### 4. Decimal-Safe USD to Lamport Conversion (`convertUsdToLamports`)
- Multiplies USD amounts by $1,000,000$ to represent micro-cents in BigInt.
- Calculates exact lamports: `(usdMicro * 1_000_000_000n) / solPriceMicro`.

---

## 4. Regression Test Verification (All 10 Scenarios Passed)

| Scenario | Input / Condition | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| **1. Low Impact Quote** | `priceImpactPct: "0.12"` (0.12%) | PASS | Verified 0.12% impact, valid outputs | ✅ PASS |
| **2. Exact 10% Boundary** | `priceImpactPct: "10.00"` (10.00%) | PASS (<= 10.0%) | Verified 10.00% allowed | ✅ PASS |
| **3. 11% Breach** | `priceImpactPct: "11.00"` (11.00%) | REJECT (`QUOTE_SAFETY_ERROR`) | Rejected: `Excessive price impact (11.00%)` | ✅ PASS |
| **4. 100% Catastrophic** | `priceImpactPct: "100.00"` (100.00%) | REJECT (`QUOTE_SAFETY_ERROR`) | Rejected: `Excessive price impact (100.00%)` | ✅ PASS |
| **5. null / NaN Impact** | `priceImpactPct: null / "undefined"` | `INVALID_QUOTE` | Rejected as `INVALID_QUOTE` (no 100% misattribution) | ✅ PASS |
| **6. Missing / Empty Route** | `routePlan: []` | `NO_ROUTE` | Rejected as `NO_ROUTE` | ✅ PASS |
| **7. Zero Output** | `outAmount: "0"` | `INVALID_QUOTE` | Rejected as `INVALID_QUOTE` | ✅ PASS |
| **8. Reversed BUY Direction** | `inputMint = Target`, `outputMint = SOL` | `INVALID_QUOTE` | Rejected: BUY inputMint must be SOL | ✅ PASS |
| **9. $1 Conversion Math** | $1 @ $200, $143.50, $20/SOL | Exact Lamports | 5M, 6.96M, 50M lamports exact | ✅ PASS |
| **10. Large BigInt Amounts** | 100 Quadrillion token units | No Precision Loss | Preserved exact BigInt integers | ✅ PASS |

---

## 5. Build & Compilation Verification
- `lint_applet` / TypeScript check: **Zero errors**
- `compile_applet` / Vite + esbuild build: **Success**
- All unit, integration, parity, and regression test suites: **100% Green**
