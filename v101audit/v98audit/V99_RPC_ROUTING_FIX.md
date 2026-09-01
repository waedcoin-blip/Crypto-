# v99 RPC Routing Fix

## Architecture
- Search: primary + optional backup
- Monitor: primary + optional backup
- Execution: primary + optional backup
- LaserStream: separate Geyser/gRPC ingestion transport

## Environment variables
SEARCH_RPC_URL, SEARCH_RPC_BACKUP_URL
MONITOR_RPC_URL, MONITOR_RPC_BACKUP_URL
EXECUTION_RPC_URL, EXECUTION_RPC_BACKUP_URL

Primary services now prefer centralized role routing while preserving existing configured-network fallback when a role endpoint is absent.
