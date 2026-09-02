# v90 (23) Critical Patch Report

Patched directly from `arina-x-ray-alpha (90) (23).zip`.

## Fixed

1. Removed the `helius-laserstream` dependency from package manifests/lockfiles.
2. Trading worker now starts Yellowstone from `YELLOWSTONE_GRPC_ENDPOINT` / `YELLOWSTONE_GRPC_DEVNET_ENDPOINT` and no longer requires `HELIUS_API_KEY`.
3. Added separate `YELLOWSTONE_GRPC_DEVNET_X_TOKEN` and `YELLOWSTONE_NETWORK` configuration.
4. Removed Helius fallback gRPC endpoints. A missing Yellowstone endpoint now disables streaming instead of silently switching providers.
5. Added explicit Yellowstone token-balance mint extraction (`preTokenBalances` + `postTokenBalances`) instead of treating arbitrary transaction account keys as token mints.
6. Added native Yellowstone reconnect/backoff configuration and a reconnect-in-progress guard.
7. Centralized BUY/rebuy limits through `isRebuyAllowed` in both manual BUY and EntryGate/auto BUY paths.
8. Pending BUYs are reservations only and do not consume completed trade slots; concurrent pending BUYs are blocked.
9. Added explicit `network` to new trade and position records so Paper/Mainnet history is isolated.
10. Removed the duplicate `autoBoughtTokens` BUY guard.
11. Failed BUY attempts release reservations and can retry later; failed BUYs do not consume a rebuy slot.
12. Fixed manual BUY cleanup so pending/optimistic state is released on success or failure.
13. Yellowstone x-token is masked in the status response.

## Verification

- All modified TypeScript/TSX files passed TypeScript transpilation/syntax diagnostics.
- Critical regression script passed.
- `package-lock.json` parses successfully.

## Environment limitation

A full dependency-resolved production build could not be executed in this environment because dependencies are not installed and the package registry request timed out. The ZIP therefore includes the corrected manifests/lockfiles, but Render/CI must run a clean dependency install before deployment.
