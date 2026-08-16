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
    const state = await criteriaService.fetchCriteriaFromFirestore((req as any).user.uid, (req as any).idToken);
    res.json({
      status: 'success',
      version: state.version,
      updatedAt: state.updatedAt,
      source: state.source,
      userId: state.userId,
      criteria: state.criteria,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    res.status(502).json({
      status: 'error',
      error: 'Persistence storage error: ' + (err.message || 'Failed to read criteria from database'),
      timestamp: Date.now(),
    });
  }
}));

// PATCH /api/criteria
router.patch('/', requireAuth, asyncHandler(async (req, res) => {
  const { expectedVersion, changes } = req.body;
  
  if (!changes) {
    res.status(400).json({ error: 'Missing changes in payload' });
    return;
  }

  try {
    const updatedState = await criteriaService.updateCriteria((req as any).idToken, changes, {
      expectedVersion
    });

    res.json({
      status: 'success',
      message: 'Criteria validated, persisted to storage, and applied to backend engine',
      version: updatedState.version,
      updatedAt: updatedState.updatedAt,
      source: updatedState.source,
      criteria: updatedState.criteria,
      timestamp: Date.now(),
    });
  } catch (e: any) {
    if (e.message?.startsWith('Conflict:')) {
      res.status(409).json({ error: e.message, code: 'VERSION_CONFLICT' });
      return;
    }
    res.status(500).json({ error: e.message || 'Criteria update failed', code: 'PERSISTENCE_ERROR' });
  }
}));


// Legacy PUT
router.put('/', requireAuth, asyncHandler(async (req, res) => {
  const updatedState = await criteriaService.updateCriteria((req as any).idToken, req.body);
  res.json({
    status: 'success',
    message: 'Criteria validated, persisted to storage, and applied to backend engine',
    version: updatedState.version,
    updatedAt: updatedState.updatedAt,
    source: updatedState.source,
    criteria: updatedState.criteria,
    timestamp: Date.now(),
  });
}));

export default router;
