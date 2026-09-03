/**
 * Telegram bot message proxy
 */
import { Router } from 'express';
import { fetchWithTimeout } from '../utils/fetch.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateRequiredString } from '../utils/validation.js';
import { BadGatewayError, ValidationError } from '../utils/errors.js';
import { config } from '../config/index.js';
import { isAllowedOrigin } from '../middleware/security.js';

const router = Router();

// Simple HTML sanitization to prevent XSS
function sanitizeHtml(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;(b|i|code|pre|a|strong|em)\b/g, '<$1')  // Allow safe tags
    .replace(/&lt;\/(b|i|code|pre|a|strong|em)&gt;/g, '</$1>');
}

router.post('/', asyncHandler(async (req, res) => {
  // SSRF/Proxy Protection
  if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
    throw new BadGatewayError('Telegram proxying requires valid CORS origin');
  }

  const token = (typeof req.body?.token === 'string' && req.body.token.trim())
    ? req.body.token.trim()
    : (process.env.TELEGRAM_BOT_TOKEN || '').trim();

  if (!token) {
    throw new ValidationError('Telegram bot token not configured (specify in settings or TELEGRAM_BOT_TOKEN)');
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

    // Read as text first to handle non-JSON responses
    const textData = await response.text();
    let result: any;
    try {
      result = JSON.parse(textData);
    } catch {
      result = { success: response.ok, raw: textData };
    }

    if (!response.ok) {
      const description = result?.description || result?.error || `HTTP ${response.status}`;
      const errMsg = `Telegram API error (${response.status}): ${description}`;
      if (response.status === 404 || response.status === 401 || response.status === 400 || response.status === 403) {
        throw new ValidationError(errMsg);
      }
      throw new BadGatewayError(errMsg);
    }

    res.status(response.status).json(result);
  } catch (error: unknown) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('Telegram Proxy Timeout');
      throw new BadGatewayError('Telegram API Timeout');
    }

    throw error;
  }
}));

export default router;
