# ARINA X-RAY ALPHA — DEPLOYMENT GUIDE

## Environment Requirements
- Node.js >= 20.0.0
- npm or bun

## Environment Variables (.env)
Documented in `.env.example`:
- `HELIUS_API_KEY`: Helius Solana RPC / WSS API Key (server-side only)
- `DEFAULT_NETWORK`: Set to `paper` for paper-trading or `mainnet` for live
- `IS_LIVE_TRADING`: `false` (default)
- `AUTO_SNIPER_ENABLED`: `true` / `false`
- `SEARCH_WS_URL`: Custom WSS endpoint override (optional)
- `SEARCH_WS_BACKUP_URL`: Backup WSS endpoint for HTTP 429 rate limit fallback (optional)

## Build Commands
```bash
# Install dependencies
npm install

# Build static frontend and bundle backend server/worker
npm run build
```

The build script generates:
- `dist/index.html` + static assets (React frontend built via Vite)
- `dist/server.cjs` (Bundled CommonJS backend server via esbuild)
- `dist/worker.cjs` (Bundled background worker via esbuild)

## Production Execution
```bash
# Start server
npm run start
```

Port `3000` on host `0.0.0.0` is used by default.
