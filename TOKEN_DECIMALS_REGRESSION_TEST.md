# Token Decimals Regression Test Report

## 1. Test Scenarios Covered
1. **Valid SPL Mint**: Verifies correct on-chain decimals resolution from mint account buffer at offset 44.
2. **Valid Token-2022 Mint**: Verifies support for Token-2022 program-owned mint accounts.
3. **Nonexistent Mint**: Verifies `INVALID_TOKEN_MINT` handling.
4. **RPC Timeout / 429**: Verifies bounded retries with exponential backoff and fallback RPC providers.
5. **Caching & Deduplication**: Verifies that duplicate concurrent requests for the same mint resolve via a single RPC call and subsequent requests hit the cache.
6. **Strict Validation**: Verifies rejection of `null`, `NaN`, negative decimals, or decimals > 255.
7. **FAMI Regression Test**: Specifically targets mint `HmaHhC9vBh43gZnNTUFGNGP1A72jH1MXKjhHRWw2Ja8F`.

## 2. Results
- **BEFORE**: `UNRESOLVED_TOKEN_DECIMALS` for FAMI when external metadata APIs failed or timed out.
- **AFTER**: Verified authoritative on-chain decimal resolution successfully retrieved from Solana mint account buffer with zero precision loss and full audit logging.
