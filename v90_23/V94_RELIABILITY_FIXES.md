# v94 Reliability Patch

## Fixed
- Token discovery requests now enforce the configured 15-second timeout.
- Discovery requests bypass browser HTTP caches.
- Explicitly timestamped discovery responses are rejected when stale.
- Scanner cache records the real scan time instead of relying on a misleading arithmetic expression.
- RPC role URLs are validated before activation through runtime configuration APIs.

## Still requires integration validation
A production mainnet RPC can only be proven by an actual `getGenesisHash()` call. This must be performed by the backend/runtime before allowing real execution. URL inspection alone cannot reliably identify the Solana cluster.

## Required deployment checks
Run the complete regression suite, then run `npm run build` and exercise token discovery, monitor RPC traffic, and Paper/Mainnet switching against live services.
