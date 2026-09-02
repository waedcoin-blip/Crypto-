/**
 * Global error handling middleware
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError, isBenignError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle AppError instances
  if (err instanceof AppError) {
    if (!isBenignError(err)) {
      logger.warn({
        code: err.code,
        message: err.message,
        path: req.path,
        method: req.method,
      }, `Operational error: ${err.message}`);
    }
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Handle benign / network / CORS errors without spamming error logs
  if (isBenignError(err)) {
    logger.debug({
      message: err.message,
      path: req.path,
      method: req.method,
    }, 'Benign error suppressed');
    
    const statusCode = (err as any).statusCode || ((err as any).status >= 400 && (err as any).status < 600 ? (err as any).status : 400);
    res.status(statusCode).json({
      error: err.message,
      code: (err as any).code || 'OPERATION_FAILED',
    });
    return;
  }

  // Log true unhandled errors
  logger.error({
    err: {
      message: err.message,
      stack: err.stack,
      name: err.name,
    },
    req: {
      method: req.method,
      path: req.path,
      query: req.query,
      ip: req.ip,
    },
  }, 'Unhandled error');

  // Handle generic errors
  const statusCode = (err as any).statusCode || 500;
  const message = config.IS_PRODUCTION && statusCode >= 500
    ? 'Internal server error'
    : err.message;

  res.status(statusCode).json({
    error: message,
    code: 'INTERNAL_ERROR',
    ...(config.IS_DEVELOPMENT && { stack: err.stack }),
  });
}

// Async handler wrapper to avoid try-catch boilerplate
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
