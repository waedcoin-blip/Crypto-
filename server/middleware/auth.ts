import { Request, Response, NextFunction } from 'express';
import { getAdminAuth } from '../utils/firebaseAdmin.js';
import { securityLogger } from '../utils/logger.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    securityLogger.warn({ ip: req.ip, path: req.path }, 'Unauthorized request: Missing Bearer token');
    res.status(401).json({ error: 'Unauthorized: Missing or invalid token', code: 'UNAUTHORIZED' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const auth = getAdminAuth();
    if (!auth) {
      securityLogger.warn({ ip: req.ip, path: req.path }, 'Auth service uninitialized on server');
      res.status(503).json({ error: 'Authentication service unavailable', code: 'AUTH_UNAVAILABLE' });
      return;
    }
    const decodedToken = await auth.verifyIdToken(idToken);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    securityLogger.warn({ ip: req.ip, path: req.path, error: (error as Error).message }, 'Unauthorized request: Invalid token');
    res.status(401).json({ error: 'Unauthorized: Invalid token', code: 'UNAUTHORIZED' });
  }
}
