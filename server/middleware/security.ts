/**
 * Security middleware: headers, CORS, rate limiting
 */
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { logger, securityLogger } from '../utils/logger.js';

export const securityHeaders = helmet({
  contentSecurityPolicy: false,
  frameguard: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
});

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;

  if (config.ALLOWED_ORIGINS.includes('*') || config.ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }

  if (process.env.APP_URL && origin.startsWith(process.env.APP_URL)) {
    return true;
  }

  try {
    const url = new URL(origin);
    const host = url.hostname;

    // Localhost / internal interfaces on any port
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
      return true;
    }

    // Cloud Run and Google AI Studio container/preview hostnames
    if (
      host.endsWith('.run.app') ||
      host.endsWith('.googleusercontent.com') ||
      host.endsWith('.aistudio.google.com') ||
      host === 'ai.studio' ||
      host.endsWith('.ai.studio') ||
      host.endsWith('.web.app') ||
      host.endsWith('.firebaseapp.com') ||
      host.endsWith('.vercel.app')
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      securityLogger.warn({ origin }, 'CORS request blocked from unauthorized origin');
      callback(new Error('Origin not allowed by CORS policy'), false);
    }
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
});

// Per-IP rate limiter using express-rate-limit (more robust than custom)
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.API_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    securityLogger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded');
    res.status(429).json({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    });
  },
});

export const swapRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.SWAP_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    securityLogger.warn({ ip: req.ip }, 'Swap rate limit exceeded');
    res.status(429).json({
      error: 'Swap rate limit exceeded. Please slow down.',
      code: 'SWAP_RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    });
  },
});

// Request logging middleware
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Only log API requests to avoid noisy logs for Vite internal files and static assets
  if (!req.path.startsWith('/api')) {
    return next();
  }

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });

  next();
}

// Error sanitization middleware - prevents leaking sensitive info
export function errorSanitizer(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);

  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let stack: string | undefined;

  if (err instanceof Error) {
    message = err.message;
    stack = err.stack;
    if ('statusCode' in err && typeof (err as any).statusCode === 'number' && (err as any).statusCode >= 400 && (err as any).statusCode < 600) {
      statusCode = (err as any).statusCode;
    }
    if ('code' in err && typeof (err as any).code === 'string') {
      code = (err as any).code;
    }
  }

  // In production, don't leak stack traces or internal details
  if (config.NODE_ENV === 'production' && statusCode >= 500) {
    message = 'Internal server error';
  }

  res.status(statusCode).json({
    error: message,
    code,
    ...(config.NODE_ENV === 'development' && { stack }),
  });
}
