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

  let token = (typeof req.body?.token === 'string' && req.body.token.trim())
    ? req.body.token.trim()
    : (process.env.TELEGRAM_BOT_TOKEN || '').trim();

  // Clean up user token input if they included URLs or 'bot' prefix
  if (token.includes('telegram.org/bot') || token.includes('t.me/bot')) {
    token = token.replace(/.*bot/i, '');
  } else {
    token = token.replace(/^bot_?/i, '');
  }
  token = token.replace(/^["']|["']$/g, '').trim();

  if (!token) {
    throw new ValidationError('Telegram bot token not configured (specify in settings or TELEGRAM_BOT_TOKEN)');
  }

  // Telegram bot token format check: <digits>:<alphanumeric>
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new ValidationError('Invalid Telegram Bot Token format. Bot tokens from @BotFather look like 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ');
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
      let description = result?.description || result?.error;
      if (response.status === 404) {
        description = 'Telegram Bot Token not found. Please check your Bot Token from @BotFather in settings.';
      } else if (response.status === 401) {
        description = 'Unauthorized Telegram Bot Token. Please check your Bot Token from @BotFather.';
      } else if (response.status === 400 && (description?.includes('chat not found') || description?.includes('chat_id'))) {
        description = 'Telegram Chat ID not found or invalid. Make sure you started a conversation with the bot first.';
      }
      const errMsg = description || `Telegram API error (${response.status})`;
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
