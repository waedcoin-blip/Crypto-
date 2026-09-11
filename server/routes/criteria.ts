// server/routes/criteria.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { CriteriaService, CRITERIA_PRESETS } from '../services/criteriaService.js';

const router = Router();

/**
 * GET /api/criteria
 * Get the active criteria configuration.
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const criteria = criteriaRepository.getActiveCriteriaSync();
  res.json({ status: 'success', criteria, timestamp: Date.now() });
}));

/**
 * PUT /api/criteria
 * Update the active criteria configuration.
 */
router.put('/', asyncHandler(async (req: Request, res: Response) => {
  const patch = req.body;
  if (!patch || typeof patch !== 'object') {
    return res.status(400).json({ status: 'error', error: 'Valid criteria patch object is required' });
  }

  const updated = criteriaRepository.updateCriteria(patch);
  res.json({ status: 'success', criteria: updated, timestamp: Date.now() });
}));

/**
 * POST /api/criteria/reset
 * Reset criteria to defaults.
 */
router.post('/reset', asyncHandler(async (req: Request, res: Response) => {
  const criteria = criteriaRepository.resetToDefaults();
  res.json({ status: 'success', criteria, message: 'Criteria reset to defaults', timestamp: Date.now() });
}));

/**
 * GET /api/criteria/presets
 * Get all available criteria presets.
 */
router.get('/presets', asyncHandler(async (req: Request, res: Response) => {
  res.json({ status: 'success', presets: CRITERIA_PRESETS, timestamp: Date.now() });
}));

/**
 * POST /api/criteria/presets/:name
 * Apply a named preset.
 */
router.post('/presets/:name', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const criteria = criteriaRepository.loadPreset(name);

  if (!criteria) {
    return res.status(404).json({ status: 'error', error: `Preset '${name}' not found` });
  }

  const updated = criteriaRepository.updateCriteria(criteria);
  res.json({ status: 'success', criteria: updated, message: `Preset '${name}' applied`, timestamp: Date.now() });
}));

/**
 * POST /api/criteria/presets/save
 * Save current criteria as a named preset.
 */
router.post('/presets/save', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ status: 'error', error: 'Preset name is required' });
  }

  const currentCriteria = criteriaRepository.getActiveCriteriaSync();
  criteriaRepository.savePreset(name, currentCriteria);

  res.json({ status: 'success', message: `Preset '${name}' saved`, timestamp: Date.now() });
}));

export default router;
