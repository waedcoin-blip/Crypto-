# Token Decimals Resolution Fix Architecture

## 1. Architectural Changes
1. **Authoritative On-Chain Decoding**:
   - Direct Solana RPC `getConnection().getAccountInfo(mintPublicKey)` querying.
   - Program validation supporting both **SPL Token Program** (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) and **Token-2022 Program** (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
   - Direct binary buffer layout decoding: Mint `decimals` byte is located at offset `44` of the account data buffer.
2. **Strict Validation**:
   - `typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255`.
   - Rejection of invalid mints (`INVALID_TOKEN_MINT`) if account does not exist or is not a valid mint.
3. **In-Flight Request Deduplication & Caching**:
   - In-flight Promise map prevents duplicate simultaneous RPC requests for the same mint address.
   - Robust cache storing mint, decimals, program, source, resolvedAt, and verification status.
4. **Structured Error Handling & Observability**:
   - Explicit errors: `TOKEN_DECIMALS_RESOLUTION_FAILED`, `INVALID_TOKEN_MINT`, `TOKEN_PROGRAM_UNSUPPORTED`, `RPC_ERROR`.
   - Structured logging (`[TOKEN] DECIMALS_RESOLUTION_STARTED`, `[TOKEN] DECIMALS_RESOLVED`, `[TOKEN] DECIMALS_RESOLUTION_FAILED`).
