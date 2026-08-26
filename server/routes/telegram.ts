/**
 * Telegram bot message proxy
 */
import { Router } from 'express';
import { fetchWithTimeout } from '../utils/fetch.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateRequiredString } from '../utils/validation.js';
import { BadGatewayError } from '../utils/errors.js';
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

  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token || !token.trim()) {
    throw new BadGatewayError('Telegram bot token not configured on server (TELEGRAM_BOT_TOKEN)');
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

    // Read as text first to handle non-JSON responses
    const textData = await response.text();
    let result;
    try {
      result = JSON.parse(textData);
    } catch {
      result = { success: true, raw: textData };
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
