// server/middleware/errorHandler.ts
import { config } from '../config/index.js';

export function asyncHandler(fn: Function) {
  return (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function globalErrorHandler(err: any, req: any, res: any, next: any) {
  // FIX: Log the FULL error details for debugging
  console.error(`[GLOBAL_ERROR_HANDLER] ${req.method} ${req.path}:`, {
    message: err?.message,
    stack: err?.stack,
    body: req?.body,
    query: req?.query,
  });

  const statusCode = err?.statusCode || err?.status || 500;
  const message = config.NODE_ENV === 'production' ? 'Internal server error' : (err?.message || 'Internal server error');

  res.status(statusCode).json({
    error: message,
    code: err?.code || 'INTERNAL_ERROR',
    // FIX: Include actual error message in non-production environments
    ...(config.NODE_ENV !== 'production' && { details: err?.message }),
  });
}