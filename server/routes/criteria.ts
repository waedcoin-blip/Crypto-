import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// GET /api/criteria or /api/config
router.get('/', (req, res) => {
  res.json({
    status: 'success',
    timestamp: Date.now()
  });
});

// POST /api/criteria or /api/config
router.post('/', asyncHandler(async (req, res) => {
  res.json({
    status: 'success',
    message: 'Criteria updated',
    timestamp: Date.now()
  });
}));

export default router;
