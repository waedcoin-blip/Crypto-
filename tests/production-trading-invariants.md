# Production Trading Invariants

- Trading denomination is SOL/lamports only. USD is informational.
- Raw SPL token quantities and lamports must remain BigInt/string across execution boundaries.
- No floating-point conversion of raw on-chain quantities.
- UnifiedExitEngine is the sole authoritative SELL/exit authority.
- Exits are full-position only; no partial TP or moonbag execution.
- RiskManager is fail-closed for unknown/unresolved/invalid token decimals.
- Executable Jupiter quotes, not estimated USD values, authorize profitability.
- Browser/UI code must not be an independent trading authority.
