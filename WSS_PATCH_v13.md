# WSS / LaserStream Patch

## Root causes fixed

1. `StreamingTransportManager.start()` started only `LaserStreamPipeline`; it did not start the Helius WSS producer.
2. WSS telemetry hard-coded the mainnet endpoint even when a custom/backup endpoint was selected.
3. WSS URL selection accepted arbitrary strings; an HTTP RPC URL in a WS config could be passed to the WebSocket client.
4. WSS normalized events were not bridged into the authoritative `MarketEventBus` used by the downstream pipeline.
5. The downstream pipeline accepted only `TRADE/BUY/SELL`, while WSS transaction observations are represented as `ON_CHAIN_TX`.
6. The pipeline used `event.mint` only and ignored `candidateMint` produced by the WSS normalizer.

## Resulting flow

Helius WSS -> WSS manager -> normalized event -> MarketEventBus -> LaserStreamPipeline -> CandidateRegistry / downstream engines

Slot-only notifications remain telemetry-only. Mint-resolved transaction observations can enter the market pipeline as `ON_CHAIN_TX`.

## Regression

Added:
- `scripts/wss-startup-regression-test.ts`
- npm script: `npm run test:wss-startup`

The existing `npm run test:helius-wss` remains available.

## Verification note

The source changes were statically inspected. Full TypeScript/npm test execution requires installing the repository dependencies in the target environment.
