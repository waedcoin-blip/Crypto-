# v100 RPC + WebSocket Isolation Patch

## Architecture
Each role has its own HTTP RPC and corresponding WebSocket endpoints:

- Search: primary + backup RPC, primary + backup WS
- Monitor: primary + backup RPC, primary + backup WS
- Execution: primary + backup RPC, primary + backup WS

Explicit WS URLs are preferred. When absent, a WS URL is derived from the corresponding RPC URL (`https→wss`, `http→ws`) while preserving host and path.

## Safety rules
- Execution endpoints are isolated from Search and Monitor routing.
- Endpoint lists are deduplicated.
- Invalid RPC/WS protocols fail closed.
- LaserStream remains an independent gRPC/Geyser ingestion path.

## Environment variables
SEARCH_RPC_URL, SEARCH_RPC_BACKUP_URL, SEARCH_WS_URL, SEARCH_WS_BACKUP_URL
MONITOR_RPC_URL, MONITOR_RPC_BACKUP_URL, MONITOR_WS_URL, MONITOR_WS_BACKUP_URL
EXECUTION_RPC_URL, EXECUTION_RPC_BACKUP_URL, EXECUTION_WS_URL, EXECUTION_WS_BACKUP_URL

## Validation
Run:
`npm run test:rpc-ws-routing`
