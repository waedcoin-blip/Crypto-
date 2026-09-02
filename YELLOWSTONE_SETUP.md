# YELLOWSTONE GEYSER gRPC SETUP & TELEMETRY GUIDE

## Configuration
Yellowstone Geyser gRPC ingestion is managed by `YellowstoneConnectionManager` (`/server/market/YellowstoneConnectionManager.ts`).

### Environment Variables
```env
# Mainnet Yellowstone gRPC
YELLOWSTONE_GRPC_ENDPOINT=https://grpc.mainnet.helius-rpc.com:443
YELLOWSTONE_GRPC_X_TOKEN=your_mainnet_token_here

# Devnet Yellowstone gRPC
YELLOWSTONE_GRPC_DEVNET_ENDPOINT=https://grpc.devnet.helius-rpc.com:443
YELLOWSTONE_GRPC_DEVNET_X_TOKEN=your_devnet_token_here
```

## Architecture & Reconnection
- **Single Connection Guarantee**: Exactly ONE active connection per network.
- **Auto-Reconnection**: Reconnects on error or end events with exponential backoff (1s up to 30s max).
- **Stall Watchdog**: Tracks `lastEventAt` and `lastReceivedSlot`.
- **Event Bus**: Publishes normalized `MarketEvent` instances to `MarketEventBus` for non-blocking distribution.
