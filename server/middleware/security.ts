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

export const corsMiddleware = cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
});

// Per-IP rate limiter using express-rate-limit (more robust than custom)
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.API_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  },
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
  keyGenerator: (req: Request) => {
    return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  },
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
export function errorSanitizer(err: Error, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);

  const statusCode = (err as any).statusCode || 500;
  const code = (err as any).code || 'INTERNAL_ERROR';

  // In production, don't leak stack traces or internal details
  const message = config.NODE_ENV === 'production' && statusCode >= 500
    ? 'Internal server error'
    : err.message;

  res.status(statusCode).json({
    error: message,
    code,
    ...(config.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
