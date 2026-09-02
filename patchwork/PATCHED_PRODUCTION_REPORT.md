# Production Trading Bug Patch

Applied to the supplied ZIP.

## Fixed
- Execution network is now explicit; wallet public-key prefixes are no longer used to select paper/devnet/mainnet.
- Mainnet execution resolves the requested configured wallet and rejects wallet/network mismatches.
- Mainnet token amounts are verified from post-confirmation on-chain balance deltas; quote output is not treated as the authoritative fill quantity.
- Mainnet token decimals are resolved from the on-chain mint and unknown decimals fail closed.
- Removed unsafe server-side 6-decimal fallbacks from token program resolution and position persistence.
- Position creation requires verified decimals.
- Persistent orders retain `clientRequestId`, restoring idempotency across restarts.
- Trade/order/position repositories no longer silently discard older authoritative records at 500 entries.
- JSON persistence uses atomic temp-file replacement and a configurable `DATA_DIR`.
- BUY validates amount/slippage and enforces server-side `MAX_POSITIONS`.
- SELL treats `0` as an invalid amount instead of converting it to full-position sell.
- SELL validates raw amounts and supports partial position reduction with proportional cost basis.
- Slippage `0` is preserved rather than replaced by a default.
- LaserStream configuration now requires authentication.
- Trading monitor uses a single-flight loop to prevent overlapping monitor cycles.
- Devnet wallet selection is explicit; simulated devnet decimals are configurable.
- Refactored architecture test import was corrected from a missing `.js` source import to `.ts`.

## Important deployment requirement
`DATA_DIR` must point to durable storage when running the server/worker. A local JSON store cannot provide cross-instance consistency by itself. For multiple server/worker replicas, use a shared transactional database before enabling concurrent live trading.

## Validation
- TypeScript source syntax diagnostics: 0 on all patched TypeScript files.
- Full dependency install/build could not be completed in this environment because the package registry request timed out / dependencies were not present locally.
- No live mainnet transaction was submitted during patching.
