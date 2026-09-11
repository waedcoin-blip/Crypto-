// server/routes/laserstream.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { streamingTransportManager } from '../market/StreamingTransportManager.js';
import { laserStreamPipeline } from '../market/LaserStreamPipeline.js';
import { sourceHealthMonitor } from '../market/SourceHealthMonitor.js';

const router = Router();

/**
 * GET /api/laserstream/status
 * Get LaserStream transport status and telemetry.
 */
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const transportState = streamingTransportManager.getState();
  const transportTelemetry = streamingTransportManager.getTelemetry();
  const pipelineTelemetry = laserStreamPipeline.getTelemetry();
  const sourceHealth = sourceHealthMonitor.getSnapshot();

  res.json({
    status: 'success',
    transport: {
      state: transportState,
      ...transportTelemetry,
    },
    pipeline: pipelineTelemetry,
    sources: sourceHealth,
    timestamp: Date.now(),
  });
}));

/**
 * GET /api/laserstream/events
 * Server-Sent Events endpoint for real-time market events.
 * Frontend connects to this to receive live updates.
 */
router.get('/events', asyncHandler(async (req: Request, res: Response) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

  // Subscribe to market events
  const { marketEventBus } = await import('../market/MarketEventBus.js');
  const unsubscribe = marketEventBus.subscribe((event: any) => {
    try {
      const data = JSON.stringify({
        type: 'market_event',
        event: {
          mint: event.mint,
          symbol: event.symbol,
          eventType: event.eventType,
          side: event.side,
          priceSol: event.priceSol,
          timestamp: event.timestamp,
        },
      });
      res.write(`data: ${data}\n\n`);
    } catch {
      // Ignore serialization errors
    }
  });

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);
  if (heartbeat.unref) heartbeat.unref();

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}));

export default router;
