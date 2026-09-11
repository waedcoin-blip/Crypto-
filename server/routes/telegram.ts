// server/routes/telegram.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';

const router = Router();

interface TelegramAlert {
  token: string;
  mint: string;
  type: string;
  message: string;
  timestamp: number;
}

// In-memory alert buffer (last 100 alerts)
const alertBuffer: TelegramAlert[] = [];
const MAX_BUFFER_SIZE = 100;

/**
 * POST /api/telegram/alert
 * Receive an alert and queue it for Telegram delivery.
 */
router.post('/alert', asyncHandler(async (req: Request, res: Response) => {
  const { token, mint, type, message } = req.body;

  if (!token || !type || !message) {
    return res.status(400).json({ status: 'error', error: 'token, type, and message are required' });
  }

  const alert: TelegramAlert = {
    token,
    mint: mint || '',
    type,
    message,
    timestamp: Date.now(),
  };

  alertBuffer.unshift(alert);
  if (alertBuffer.length > MAX_BUFFER_SIZE) {
    alertBuffer.length = MAX_BUFFER_SIZE;
  }

  // TODO: In production, send to Telegram Bot API here
  // const botToken = config.TELEGRAM_BOT_TOKEN;
  // const chatId = config.TELEGRAM_CHAT_ID;
  // await sendTelegramMessage(botToken, chatId, formatAlert(alert));

  res.json({ status: 'success', message: 'Alert queued', timestamp: Date.now() });
}));

/**
 * GET /api/telegram/alerts
 * Get recent alerts from the buffer.
 */
router.get('/alerts', asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 20, MAX_BUFFER_SIZE);
  res.json({
    status: 'success',
    count: alertBuffer.length,
    alerts: alertBuffer.slice(0, limit),
    timestamp: Date.now(),
  });
}));

/**
 * GET /api/telegram/config
 * Get Telegram configuration status (redacted).
 */
router.get('/config', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    status: 'success',
    configured: false, // Set to true when TELEGRAM_BOT_TOKEN is configured
    timestamp: Date.now(),
  });
}));

export default router;
