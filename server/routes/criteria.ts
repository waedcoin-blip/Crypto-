import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { criteriaService } from '../services/criteriaService.js';

const router = Router();

// GET /api/criteria or /api/config
router.get('/', (req, res) => {
  const state = criteriaService.getCriteriaState();
  res.json({
    status: 'success',
    version: state.version,
    updatedAt: state.updatedAt,
    source: state.source,
    userId: state.userId,
    criteria: state.criteria,
    timestamp: Date.now(),
  });
});

// PUT /api/criteria or /api/config
router.put('/', asyncHandler(async (req, res) => {
  const updatedState = criteriaService.updateCriteria(req.body, {
    source: req.body?.source || 'live_user_update',
    userId: req.body?.userId,
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
}));

// POST /api/criteria or /api/config
router.post('/', asyncHandler(async (req, res) => {
  const updatedState = criteriaService.updateCriteria(req.body, {
    source: req.body?.source || 'live_user_update',
    userId: req.body?.userId,
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
}));

export default router;

