// server/routes/rpc.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';

const router = Router();

interface RpcEndpoint {
  url: string;
  label: string;
  latencyMs: number | null;
  healthy: boolean;
  lastChecked: number;
}

/**
 * GET /api/rpc/status
 * Returns the status of all configured RPC endpoints.
 */
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const endpoints: RpcEndpoint[] = [];

  const rpcConfigs = [
    { url: config.SEARCH_RPC_URL, label: 'Search RPC' },
    { url: config.SEARCH_RPC_BACKUP_URL, label: 'Search RPC Backup' },
    { url: config.MONITOR_RPC_URL, label: 'Monitor RPC' },
    { url: config.MONITOR_RPC_BACKUP_URL, label: 'Monitor RPC Backup' },
    { url: config.EXECUTION_RPC_URL, label: 'Execution RPC' },
    { url: config.EXECUTION_RPC_BACKUP_URL, label: 'Execution RPC Backup' },
  ];

  for (const cfg of rpcConfigs) {
    if (!cfg.url) continue;

    const start = Date.now();
    try {
      const response = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - start;
      endpoints.push({
        url: cfg.url.replace(/api-key=[a-zA-Z0-9-_]+/g, 'api-key=***'),
        label: cfg.label,
        latencyMs,
        healthy: response.ok,
        lastChecked: Date.now(),
      });
    } catch (err: any) {
      endpoints.push({
        url: cfg.url.replace(/api-key=[a-zA-Z0-9-_]+/g, 'api-key=***'),
        label: cfg.label,
        latencyMs: Date.now() - start,
        healthy: false,
        lastChecked: Date.now(),
      });
    }
  }

  res.json({
    status: 'success',
    endpoints,
    timestamp: Date.now(),
  });
}));

/**
 * GET /api/rpc/config
 * Returns the current RPC configuration (redacted).
 */
router.get('/config', asyncHandler(async (req: Request, res: Response) => {
  const redact = (url?: string) => url ? url.replace(/api-key=[a-zA-Z0-9-_]+/g, 'api-key=***') : undefined;

  res.json({
    status: 'success',
    config: {
      search: {
        primary: redact(config.SEARCH_RPC_URL),
        backup: redact(config.SEARCH_RPC_BACKUP_URL),
        ws: redact(config.SEARCH_WS_URL),
        wsBackup: redact(config.SEARCH_WS_BACKUP_URL),
      },
      monitor: {
        primary: redact(config.MONITOR_RPC_URL),
        backup: redact(config.MONITOR_RPC_BACKUP_URL),
        ws: redact(config.MONITOR_WS_URL),
        wsBackup: redact(config.MONITOR_WS_BACKUP_URL),
      },
      execution: {
        primary: redact(config.EXECUTION_RPC_URL),
        backup: redact(config.EXECUTION_RPC_BACKUP_URL),
        ws: redact(config.EXECUTION_WS_URL),
        wsBackup: redact(config.EXECUTION_WS_BACKUP_URL),
      },
    },
    timestamp: Date.now(),
  });
}));

export default router;
