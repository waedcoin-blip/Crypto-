# ARINA X-RAY — Pulse / Unified BUY Fix Patch

This patch establishes a dependency-light contract for the unified multi-source
BUY architecture and adds regression coverage preventing simulation from being
treated as a LIVE discovery source.

## Required live flow

PULSE_FEED / LASERSTREAM / HELIUS_WSS / PUMP_FUN / DEXSCREENER
-> canonical UnifiedMarketEvent
-> MarketEventBus
-> CandidateRegistry
-> Momentum/Risk
-> EntryEngine
-> TradingEngine
-> Jupiter

DexScreener must not be a mandatory gate for the other discovery sources.

## Important

This patch does not submit real transactions and does not claim that a live
Pulse Feed integration has been proven merely by static code. After applying it,
run the project's full build/test suite and perform the source-by-source trace.

SELL, PnL, TP, SL and trailing-stop logic are explicitly out of scope.
