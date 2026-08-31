/**
 * Helius LaserStream SSE endpoints
 */
import { Router } from 'express';
import { config } from '../config/index.js';
import { laserLogger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isAllowedOrigin } from '../middleware/security.js';
import type { SseClient, LaserStreamOptions, LaserStreamStatus, SseEvent } from '../types/index.js';
import { z } from 'zod';
import {
  startLaserStream,
  stopLaserStream,
  isLaserStreamUsingFallback,
  isLaserStreamSimulated,
  getActiveLaserStreamEndpoint,
  getLaserStreamTelemetry,
} from '../engines/LaserstreamIngestion.js';
import { laserStreamWatchdog } from '../services/LaserStreamWatchdog.js';

const router = Router();

// ─── State ───
const clients: SseClient[] = [];
let isActive = false;
let currentOptions: LaserStreamOptions = {
  apiKey: process.env.HELIUS_API_KEY || '',
  endpoint: 'auto',
  network: 'mainnet',
  programAddresses: [],
};

// ─── Wire Watchdog Handlers ───
// FIX: The watchdog stores these but never used them. Wire them here or in LaserstreamIngestion.
laserStreamWatchdog.setReconnectHandler(async (fromSlot) => {
  laserLogger.warn({ fromSlot }, 'Watchdog triggered reconnect');
  try {
    await stopLaserStream();
    await startLaserStream(currentOptions, broadcastToClients);
    laserLogger.info({ fromSlot }, 'Watchdog reconnect completed');
  } catch (err) {
    laserLogger.error({ error: err, fromSlot }, 'Watchdog reconnect failed');
    throw err; // Let watchdog reset isReconnecting
  }
});

laserStreamWatchdog.setHealthCheckHandler(async () => {
  // Optional: implement deep health probe (e.g., ping Helius RPC)
  laserLogger.debug('Watchdog health check tick');
});

// ─── Watchdog State Listener for Real-time SSE Broadcast ───
laserStreamWatchdog.onStateChange((status, telemetry) => {
  broadcastToClients({
    type: 'STATUS',
    status,
    laserstreamActive: isActive,
    isFallback: isLaserStreamUsingFallback(),
    isSimulated: isLaserStreamSimulated(),
    activeEndpoint: getActiveLaserStreamEndpoint(),
    network: currentOptions.network || 'mainnet',
    telemetry,
  } as SseEvent);
});

// ─── SSE Heartbeat ───
const heartbeatInterval = setInterval(() => {
  if (clients.length === 0) return;

  const telemetry = getLaserStreamTelemetry();
  const ping = JSON.stringify({
    type: 'HEARTBEAT',
    timestamp: Date.now(),
    telemetry,
  });
  const deadClients: string[] = [];

  clients.forEach((client) => {
    try {
      client.res.write(`data: ${ping}\n\n`);
      if (typeof (client.res as any).flush === 'function') {
        (client.res as any).flush();
      }
    } catch {
      deadClients.push(client.id);
    }
  });

  if (deadClients.length > 0) {
    for (let i = clients.length - 1; i >= 0; i--) {
      if (deadClients.includes(clients[i].id)) {
        clients.splice(i, 1);
      }
    }
    laserLogger.debug({ removed: deadClients.length, remaining: clients.length }, 'Cleaned dead SSE clients');
  }
}, 10000);

// FIX: Clean up heartbeat on graceful shutdown to avoid dangling timers in tests/PM2
const cleanupHeartbeat = () => {
  clearInterval(heartbeatInterval);
};
process.on('SIGINT', cleanupHeartbeat);
process.on('SIGTERM', cleanupHeartbeat);

// ─── Broadcast helper ───
export function broadcastToClients(event: SseEvent): void {
  const dataString = JSON.stringify(event);
  const deadClients: string[] = [];

  clients.forEach((client) => {
    try {
      client.res.write(`data: ${dataString}\n\n`);
      if (typeof (client.res as any).flush === 'function') {
        (client.res as any).flush();
      }
    } catch {
      deadClients.push(client.id);
    }
  });

  if (deadClients.length > 0) {
    for (let i = clients.length - 1; i >= 0; i--) {
      if (deadClients.includes(clients[i].id)) {
        clients.splice(i, 1);
      }
    }
  }
}

function getSafeStatus(): LaserStreamStatus {
  const telemetry = getLaserStreamTelemetry();
  return {
    active: isActive,
    network: currentOptions.network || 'mainnet',
    options: {
      ...currentOptions,
      apiKey: currentOptions.apiKey ? '***' : '',
    },
    clientsCount: clients.length,
    isFallback: isLaserStreamUsingFallback(),
    isSimulated: isLaserStreamSimulated(),
    activeEndpoint: getActiveLaserStreamEndpoint(),
    telemetry,
  };
}

// ─── Routes ───

// GET /api/laserstream/status
router.get('/status', (req, res) => {
  res.json(getSafeStatus());
});

// GET /api/laserstream/health
router.get('/health', (req, res) => {
  const telemetry = getLaserStreamTelemetry();
  const isHealthy =
    telemetry.status === 'connected' ||
    telemetry.status === 'degraded' ||
    telemetry.status === 'replaying' ||
    telemetry.status === 'fallback' ||
    telemetry.status === 'simulated';
  res.status(isHealthy ? 200 : 503).json({
    status: telemetry.status,
    healthy: isHealthy,
    active: isActive,
    telemetry,
  });
});

const ConfigSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().optional(),
  network: z.enum(['mainnet']).optional(),
  endpoint: z.string().optional(),
  programAddresses: z.array(z.string()).max(10).optional(),
  customWsUrl: z.string().url().optional().or(z.literal('')),
});

// POST /api/laserstream/config
router.post('/config', asyncHandler(async (req, res) => {
  if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
    return res.status(401).json({ success: false, message: 'Unauthorized origin' });
  }

  const parsed = ConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid config payload',
      errors: parsed.error.issues,
    });
  }

  const { enabled, apiKey, network, endpoint, programAddresses, customWsUrl } = parsed.data;

  currentOptions = {
    apiKey: apiKey !== undefined ? apiKey : currentOptions.apiKey,
    network: network || currentOptions.network || 'mainnet',
    endpoint: endpoint || currentOptions.endpoint || 'auto',
    programAddresses: programAddresses || currentOptions.programAddresses,
    customWsUrl: customWsUrl !== undefined ? customWsUrl : currentOptions.customWsUrl,
  };

  // Vercel doesn't support long-lived processes
  if (config.IS_VERCEL) {
    const wsHost = 'mainnet.helius-rpc.com';
    return res.json({
      success: true,
      active: enabled,
      network: currentOptions.network,
      options: { ...currentOptions, apiKey: currentOptions.apiKey ? '***' : '' },
      clientsCount: 0,
      isFallback: true,
      isSimulated: false,
      activeEndpoint: `WebSocket (Vercel Fallback: ${wsHost})`,
      telemetry: getLaserStreamTelemetry(),
    });
  }

  if (enabled) {
    await stopLaserStream();
    await startLaserStream(currentOptions, broadcastToClients);
    isActive = true;
    laserLogger.info({ clients: clients.length, network: currentOptions.network }, 'LaserStream started');
  } else {
    await stopLaserStream();
    isActive = false;
    // FIX: Reset watchdog so stale metrics don't persist across restarts
    laserStreamWatchdog.reset(true);
    laserLogger.info('LaserStream stopped');
  }

  // FIX: Broadcast the *watchdog's actual status* instead of a synthetic isActive string
  const telemetry = getLaserStreamTelemetry();
  broadcastToClients({
    type: 'STATUS',
    status: telemetry.status,
    laserstreamActive: isActive,
    isFallback: isLaserStreamUsingFallback(),
    isSimulated: isLaserStreamSimulated(),
    activeEndpoint: getActiveLaserStreamEndpoint(),
    network: currentOptions.network || 'mainnet',
    telemetry,
  } as SseEvent);

  res.json(getSafeStatus());
}));

const MAX_SSE_CLIENTS = 100;

// GET /api/laserstream/stream (SSE)
router.get('/stream', (req, res) => {
  if (clients.length >= MAX_SSE_CLIENTS) {
    res.status(503).json({ errDetails: 'SSE server capacity reached' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-No-Compression', '1');
  res.flushHeaders();

  // Send padding for some strict proxies (e.g. Render)
  res.write(': ' + Array(2049).join(' ') + '\n\n');

  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const client: SseClient = {
    res,
    id: clientId,
    connectedAt: Date.now(),
  };

  clients.push(client);
  laserLogger.info({ clientId, total: clients.length }, 'SSE client connected');

  // FIX: Send initial status from watchdog, not synthetic isActive boolean
  const telemetry = getLaserStreamTelemetry();
  res.write(
    `data: ${JSON.stringify({
      type: 'STATUS',
      status: telemetry.status,
      laserstreamActive: isActive,
      isFallback: isLaserStreamUsingFallback(),
      isSimulated: isLaserStreamSimulated(),
      activeEndpoint: getActiveLaserStreamEndpoint(),
      network: currentOptions.network || 'mainnet',
      telemetry,
    })}\n\n`
  );
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }

  const cleanup = () => {
    const idx = clients.findIndex((c) => c.id === clientId);
    if (idx !== -1) {
      clients.splice(idx, 1);
      laserLogger.info({ clientId, remaining: clients.length }, 'SSE client disconnected');
    }
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
});

export { heartbeatInterval };
export default router;
