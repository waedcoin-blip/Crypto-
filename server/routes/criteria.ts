import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { criteriaService } from '../services/criteriaService.js';
import { adminAuth } from '../utils/firebaseAdmin.js';

const router = Router();

// Middleware to extract and verify ID token
const requireAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    (req as any).user = decoded;
    (req as any).idToken = idToken;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: Invalid ID token' });
  }
});

// GET /api/criteria
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  try {
    const criteria = criteriaService.getCriteria();
    res.json({
      status: 'success',
      version: 1,
      updatedAt: Date.now(),
      source: 'memory',
      userId: (req as any).user?.uid,
      criteria,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    res.status(502).json({
      status: 'error',
      error: 'Persistence storage error: ' + (err.message || 'Failed to read criteria'),
      timestamp: Date.now(),
    });
  }
}));

// PATCH /api/criteria
router.patch('/', requireAuth, asyncHandler(async (req, res) => {
  const { changes } = req.body;
  const patch = changes || req.body;
  
  if (!patch) {
    res.status(400).json({ error: 'Missing changes in payload' });
    return;
  }

  try {
    const updatedCriteria = criteriaService.updateCriteria(patch);

    res.json({
      status: 'success',
      message: 'Criteria validated and applied to backend engine',
      version: 1,
      updatedAt: Date.now(),
      source: 'memory',
      criteria: updatedCriteria,
      timestamp: Date.now(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Criteria update failed', code: 'PERSISTENCE_ERROR' });
  }
}));

// Legacy PUT
router.put('/', requireAuth, asyncHandler(async (req, res) => {
  const updatedCriteria = criteriaService.updateCriteria(req.body);
  res.json({
    status: 'success',
    message: 'Criteria validated and applied to backend engine',
    version: 1,
    updatedAt: Date.now(),
    source: 'memory',
    criteria: updatedCriteria,
    timestamp: Date.now(),
  });
}));

export default router;
