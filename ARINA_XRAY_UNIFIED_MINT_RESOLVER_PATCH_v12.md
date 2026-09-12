# Arina X-Ray Alpha v12 — Unified Mint Resolver Patch

## Fix
The reported mint
`HJE2DEZXvErwUabTU16xzrS629qXVeVyTGvJYJVfpump`
is a valid 32-byte Solana Base58 public key. The literal `.pump` suffix is not invalid.

v12 makes `server/market/TokenMintResolver` the authoritative runtime mint identity service.

## Changes
- Unified `TokenMintResolver.ts` and `TokenMintResolver.js` around the same strict implementation.
- Removed the `TestMint...` PublicKey bypass.
- Added strict Base58 decode + exactly 32-byte validation + `PublicKey` canonicalization.
- Preserves Base58 case; never lowercases Solana addresses.
- Added `normalizeMint()` as the canonical identity operation.
- Keeps `isValidMint()` as a fast syntax/non-program filter; on-chain ownership is checked by `validateTokenMint()`.
- On-chain validation now requires SPL Token or Token-2022 ownership and a minimum mint-account data length.
- Updated `TradingEngine` so every BUY first receives the same canonical mint identity on paper, Devnet, and mainnet.
- Updated `CandidateRegistry` and `CanonicalEventNormalizer` to use the authoritative resolver instead of the old utility implementation.
- Updated `HardenedApprovalStore` so approval keys use canonical Base58 instead of the unsafe `.toLowerCase()` transformation.
- Added regression coverage for the exact reported `.pump` mint, whitespace, Base58 case sensitivity, fake TestMint rejection, malformed addresses, program IDs, and log extraction.
- Updated the paper E2E test to use a real deterministic Solana public key instead of a synthetic TestMint string.

## Validation
Static JavaScript syntax checks pass for all modified JavaScript files.

The full npm test suite could not be executed in this environment because dependency installation (`npm ci`) timed out before completing. The new regression test is included and is wired into `npm test` as `test:mint-resolver`.

## Important production behavior
A syntactically valid public key is not automatically an on-chain token mint. For Devnet/mainnet, `validateTokenMint()` still verifies the account exists and is owned by SPL Token or Token-2022. Pool/liquidity/execution validation remains downstream.

Synthetic paper fixtures should use real generated PublicKey strings, not strings that masquerade as Solana addresses.
