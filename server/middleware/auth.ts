import { Request, Response, NextFunction } from 'express';
import { getAdminAuth } from '../utils/firebaseAdmin.js';
import { securityLogger } from '../utils/logger.js';
import { config } from '../config/index.js';

/**
 * Validates request authentication strictly.
 * Supports:
 * 1. Bearer <FirebaseIdToken> validated against Firebase Admin Auth
 * 2. Server-to-server Pipeline / Internal API Secret via x-pipeline-secret or x-api-key headers
 *
 * Invariant: Missing or invalid credentials MUST return HTTP 401.
 * If auth service is uninitialized and no internal secret matches: HTTP 503.
 * No anonymous or dev bypasses are permitted.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // 1. Check for server-to-server internal API / pipeline secret
  const pipelineSecretHeader = req.headers['x-pipeline-secret'] || req.headers['x-internal-secret'] || req.headers['x-api-key'];
  const configuredSecret = config.PIPELINE_API_SECRET || process.env.PIPELINE_SECRET || process.env.SERVER_INTERNAL_SECRET;

  if (pipelineSecretHeader && configuredSecret && String(pipelineSecretHeader) === configuredSecret) {
    (req as any).user = {
      uid: 'service_account',
      email: 'service@arina.internal',
      role: 'admin',
      isServiceAccount: true,
    };
    return next();
  }

  // 2. Check Bearer token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    securityLogger.warn({ ip: req.ip, path: req.path }, 'Unauthorized request: Missing or invalid Bearer token');
    res.status(401).json({ error: 'Unauthorized: Missing or invalid Bearer token', code: 'UNAUTHORIZED' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1]?.trim();
  if (!idToken) {
    securityLogger.warn({ ip: req.ip, path: req.path }, 'Unauthorized request: Empty Bearer token');
    res.status(401).json({ error: 'Unauthorized: Empty token', code: 'UNAUTHORIZED' });
    return;
  }

  // If the Bearer token matches the internal pipeline secret
  if (configuredSecret && idToken === configuredSecret) {
    (req as any).user = {
      uid: 'service_account',
      email: 'service@arina.internal',
      role: 'admin',
      isServiceAccount: true,
    };
    return next();
  }

  try {
    const auth = getAdminAuth();
    if (!auth) {
      securityLogger.warn({ ip: req.ip, path: req.path }, 'Auth service uninitialized on server');
      res.status(503).json({ error: 'Authentication service unavailable', code: 'AUTH_UNAVAILABLE' });
      return;
    }

    const decodedToken = await auth.verifyIdToken(idToken);
    if (!decodedToken || !decodedToken.uid) {
      securityLogger.warn({ ip: req.ip, path: req.path }, 'Unauthorized request: Invalid token decoded');
      res.status(401).json({ error: 'Unauthorized: Invalid token payload', code: 'UNAUTHORIZED' });
      return;
    }

    (req as any).idToken = idToken;
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    securityLogger.warn({ ip: req.ip, path: req.path, error: (error as Error).message }, 'Unauthorized request: Token verification failed');
    res.status(401).json({ error: 'Unauthorized: Invalid token', code: 'UNAUTHORIZED' });
  }
}

