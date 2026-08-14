/**
 * Telegram bot message proxy
 */
import { Router } from 'express';
import { fetchWithTimeout } from '../utils/fetch.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateRequiredString } from '../utils/validation.js';
import { BadGatewayError } from '../utils/errors.js';

const router = Router();

// Simple HTML sanitization to prevent XSS
function sanitizeHtml(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;(b|i|code|pre|a|strong|em)/g, '<$1')  // Allow safe tags
    .replace(/&lt;\/(b|i|code|pre|a|strong|em)&gt;/g, '</$1>');
}

router.post('/', asyncHandler(async (req, res) => {
  // SSRF/Proxy Protection: Only allow requests originating from the same browser context 
  // or explicit authorized origins, or require server-configured token.
  // Using an open proxy for user-supplied Telegram tokens is dangerous.
  const envToken = process.env.TELEGRAM_BOT_TOKEN || process.env.VITE_TELEGRAM_BOT_TOKEN;
  const token = envToken || (req.body.token && typeof req.body.token === 'string' ? req.body.token.trim() : '');
  
  if (!envToken && (!req.headers.origin || !req.headers.origin.includes(req.hostname))) {
     // If not using server token, block cURL/external requests that don't pass Origin matching hostname
     // This mitigates the worst of the open proxy abuse.
     throw new BadGatewayError('Telegram proxying of arbitrary tokens requires valid CORS origin');
  }

  if (!token) {
    throw new BadGatewayError('Telegram bot token not configured');
  }
  const chatId = validateRequiredString(req.body.chatId, 'chatId');
  const text = validateRequiredString(req.body.text, 'text');

  const sanitizedText = sanitizeHtml(text);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: sanitizedText,
        parse_mode: 'HTML',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new BadGatewayError(`Telegram API returned ${response.status}`);
    }

    const result = await response.json();
    res.status(response.status).json(result);
  } catch (error: any) {
    clearTimeout(timeout);

    if (error.name === 'AbortError') {
      logger.error('Telegram Proxy Timeout');
      throw new BadGatewayError('Telegram API Timeout');
    }

    throw error;
  }
}));

export default router;
