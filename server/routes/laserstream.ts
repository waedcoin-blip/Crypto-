/**
 * Helius LaserStream SSE endpoints
 */
import { Router } from 'express';
import { config } from '../config/index.js';
import { laserLogger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { SseClient, LaserStreamOptions, LaserStreamStatus, SseEvent } from '../types/index.js';
import {
  startLaserStream,
  stopLaserStream,
  isLaserStreamUsingFallback,
  isLaserStreamSimulated,
  getActiveLaserStreamEndpoint,
} from '../engines/LaserstreamIngestion.js';

const router = Router();

// ─── State ───
const clients: SseClient[] = [];
let isActive = false;
let currentOptions: LaserStreamOptions = {
  apiKey: process.env.HELIUS_API_KEY || '',
  endpoint: 'auto',
  programAddresses: [
    '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun
    '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe', // Raydium AMM
  ],
};

// ─── SSE Heartbeat ───
const heartbeatInterval = setInterval(() => {
  if (clients.length === 0) return;

  const ping = JSON.stringify({ type: 'HEARTBEAT', timestamp: Date.now() });
  const deadClients: string[] = [];

  clients.forEach((client) => {
    try {
      client.res.write(`data: ${ping}\n\n`);
    } catch {
      deadClients.push(client.id);
    }
  });

  // Remove dead clients
  if (deadClients.length > 0) {
    for (let i = clients.length - 1; i >= 0; i--) {
      if (deadClients.includes(clients[i].id)) {
        clients.splice(i, 1);
      }
    }
    laserLogger.debug({ removed: deadClients.length, remaining: clients.length }, 'Cleaned dead SSE clients');
  }
}, 15000);

// ─── Broadcast helper ───
export function broadcastToClients(event: SseEvent): void {
  const dataString = JSON.stringify(event);
  clients.forEach((client) => {
    try {
      client.res.write(`data: ${dataString}\n\n`);
    } catch {
      // Client disconnected
    }
  });
}

// ─── Routes ───

// GET /api/laserstream/status
router.get('/status', (req, res) => {
  const status: LaserStreamStatus = {
    active: isActive,
    options: currentOptions,
    clientsCount: clients.length,
    isFallback: isLaserStreamUsingFallback(),
    isSimulated: isLaserStreamSimulated(),
    activeEndpoint: getActiveLaserStreamEndpoint(),
  };

  res.json(status);
});

// POST /api/laserstream/config
router.post('/config', asyncHandler(async (req, res) => {
  const { enabled, apiKey, endpoint, programAddresses, customWsUrl } = req.body;

  currentOptions = {
    apiKey: apiKey || currentOptions.apiKey,
    endpoint: endpoint || currentOptions.endpoint,
    programAddresses: programAddresses || currentOptions.programAddresses,
    customWsUrl: customWsUrl || currentOptions.customWsUrl,
  };

  // Vercel doesn't support long-lived processes
  if (config.IS_VERCEL) {
    return res.json({
      success: true,
      active: enabled,
      options: currentOptions,
      clientsCount: 0,
      isFallback: true,
      isSimulated: false,
      activeEndpoint: 'WebSocket (Vercel Fallback)',
    });
  }

  if (enabled) {
    await stopLaserStream();
    await startLaserStream(currentOptions, broadcastToClients);
    isActive = true;
    laserLogger.info({ clients: clients.length }, 'LaserStream started');
  } else {
    await stopLaserStream();
    isActive = false;
    laserLogger.info('LaserStream stopped');
  }

  const status: LaserStreamStatus = {
    active: isActive,
    options: currentOptions,
    clientsCount: clients.length,
    isFallback: isLaserStreamUsingFallback(),
    isSimulated: isLaserStreamSimulated(),
    activeEndpoint: getActiveLaserStreamEndpoint(),
  };

  broadcastToClients({
    type: 'STATUS',
    status: isActive ? 'connected' : 'disconnected',
    laserstreamActive: isActive,
    isFallback: isLaserStreamUsingFallback(),
    isSimulated: isLaserStreamSimulated(),
    activeEndpoint: getActiveLaserStreamEndpoint(),
  } as any);

  res.json(status);
}));

const MAX_SSE_CLIENTS = 100;

// GET /api/laserstream/stream (SSE)
router.get('/stream', (req, res) => {
  if (clients.length >= MAX_SSE_CLIENTS) {
    res.status(503).json({ error: 'SSE server capacity reached' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const client: SseClient = {
    res,
    id: clientId,
    connectedAt: Date.now(),
  };

  clients.push(client);
  laserLogger.info({ clientId, total: clients.length }, 'SSE client connected');

  // Send initial status
  res.write(
    `data: ${JSON.stringify({
      type: 'STATUS',
      status: isActive ? 'connected' : 'disconnected',
      laserstreamActive: isActive,
      isFallback: isLaserStreamUsingFallback(),
      isSimulated: isLaserStreamSimulated(),
      activeEndpoint: getActiveLaserStreamEndpoint(),
    })}\n\n`
  );

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
