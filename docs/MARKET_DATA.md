# ARINA X-RAY ALPHA — MARKET DATA & STREAMING PIPELINE

## Subsystems

### 1. Helius Standard WSS Transport (`HeliusLaserStreamWssManager`)
- Implements `StreamingTransport` interface.
- Manages connection lifecycle to Helius Solana WebSocket endpoint (`wss://mainnet.helius-rpc.com/?api-key=...`).
- Features:
  - **Heartbeat & Ping/Pong**: Sends WebSocket pings every 25 seconds; terminates socket if pong is unacknowledged for > 10s.
  - **Staleness Monitor**: Reconnects automatically if no messages are received for > 120s.
  - **HTTP 429 Rate Limit Backoff**: Exponential backoff (starting at 15s up to 120s with random jitter) when rate-limited.
  - **Fallback Endpoint**: Automatically uses `SEARCH_WS_BACKUP_URL` if primary endpoint hits rate limits.
  - **Signature Fast Path**: Uses `signatureSubscribe` for rapid sell transaction confirmation.
  - **API Key Sanitization**: Masks keys in logs and telemetry output.

### 2. On-Chain Event Normalizer (`OnChainEventNormalizer`)
- Transforms raw Solana JSON-RPC WSS notifications (slot, logs, account, program updates) into standardized `UnifiedMarketEvent` objects.

### 3. Active Position Market Feed (`ActivePositionMarketFeed`)
- Ingests market events for active positions.
- Runs independently of supervisor trading state.
- Subscribes active position mints to live WSS log stream.
- Polling Fallback: Automatically polls DexScreener/Jupiter API every 3 seconds for positions that do not have active WSS log events.
- Drives `PositionValuationEngine` and triggers `UnifiedExitEngine` on TP/SL conditions.
