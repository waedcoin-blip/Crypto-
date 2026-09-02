# v90 Rebuy + Yellowstone Patch

## Included
- Rebuy count now counts actual BUY records, not a boolean `hasTradedBefore`.
- Paper/devnet/mainnet trade history is namespaced by `network`.
- Pending BUY reserves exactly one trade slot and is not double-counted with the active position.
- Auto scanner no longer globally excludes previously traded mints when rebuy is enabled; the central rebuy guard decides eligibility.
- Sniper/manual BUY records persist their network namespace.
- Replaced `helius-laserstream` transport with `@triton-one/yellowstone-grpc`.
- Yellowstone native reconnect/backfill/dedup options are enabled.
- Removed Helius regional LaserStream endpoint selection.
- Added `YELLOWSTONE_GRPC_ENDPOINT`, `YELLOWSTONE_GRPC_X_TOKEN`, and optional `YELLOWSTONE_GRPC_DEVNET_ENDPOINT`.
- Server SSE route remains `/api/laserstream/*` for UI compatibility.

## Install
Run in the project root:

    npm install

This installs `@triton-one/yellowstone-grpc` and removes `helius-laserstream` according to package.json.

## Environment

    YELLOWSTONE_GRPC_ENDPOINT=<your Yellowstone Geyser gRPC endpoint>
    YELLOWSTONE_GRPC_X_TOKEN=<provider x-token, if required>
    YELLOWSTONE_GRPC_DEVNET_ENDPOINT=<optional devnet endpoint>

The Yellowstone client is open-source, but an endpoint/token is still required unless you run your own Geyser/Yellowstone infrastructure. Do not put the x-token in browser code.

## Verification

    npm run lint
    npm run build
    npm run test:laserstream

Then check `/api/laserstream/status` and confirm the active transport is `grpc`, the endpoint is the configured Yellowstone endpoint, and no `helius-laserstream` package/import remains.
