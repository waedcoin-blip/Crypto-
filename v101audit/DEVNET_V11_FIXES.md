# Devnet v11 safety fixes

- User wallet and server settlement wallet are explicitly separated.
- `DEVNET_SETTLEMENT_PRIVATE_KEY` is required; no fallback keypair is generated or persisted.
- Devnet token accounts are regular SPL token accounts created with `SystemProgram.createAccount` + `createInitializeAccountInstruction`. The Associated Token Account program is not used by the Devnet swap builder or shadow mint creator.
- The client quote is not trusted by the server. Devnet settlement output is calculated server-side from `DEVNET_TOKEN_PRICE_SOL`.
- Devnet TP/SL price polling uses `/api/devnet-swap/prices` and does not use Jupiter/DexScreener mainnet pricing.
- Token decimals are explicit; no `amount > 1e6` decimal inference remains in `PositionExitManager`.
- BUY/SELL transactions are reconciled against expected Devnet balance changes after confirmation.
- SELL is blocked when the user has no token account for the target mint.
