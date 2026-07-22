/**
 * FTP hosting and deployment endpoints
 */
import { Router } from 'express';
import { config } from '../config/index.js';
import { ftpLogger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateFtpCredentials } from '../utils/validation.js';
import { UnauthorizedError } from '../utils/errors.js';
import { testFtpConnection, backupFtpData, deployFtpDist } from '../services/ftpService.js';
import type { BackupData } from '../services/ftpService.js';

const router = Router();

function checkFtpAllowlist(host: string): void {
  if (config.ALLOWED_FTP_HOSTS.length > 0 && !config.ALLOWED_FTP_HOSTS.includes(host)) {
    ftpLogger.warn({ host }, 'FTP host not in allowlist');
    throw new UnauthorizedError('Host not in allowlist');
  }
}

// POST /api/hosting/test
router.post('/test', asyncHandler(async (req, res) => {
  const credentials = validateFtpCredentials(req.body);
  checkFtpAllowlist(credentials.host);

  const response = await testFtpConnection(credentials);
  res.json(response);
}));

// POST /api/hosting/backup
router.post('/backup', asyncHandler(async (req, res) => {
  const credentials = validateFtpCredentials(req.body);
  checkFtpAllowlist(credentials.host);

  const { data } = req.body;
  if (!data) {
    return res.status(400).json({ success: false, message: 'No data provided to backup.' });
  }

  const backupData: BackupData = {
    positions: data.positions ?? {},
    stats: data.stats ?? {},
    logs: typeof data.logs === 'string' ? data.logs : JSON.stringify(data.logs),
    timestamp: data.timestamp || new Date().toISOString(),
  };

  const response = await backupFtpData(credentials, backupData);
  res.json(response);
}));

// POST /api/hosting/deploy
router.post('/deploy', asyncHandler(async (req, res) => {
  const credentials = validateFtpCredentials(req.body);
  checkFtpAllowlist(credentials.host);

  const response = await deployFtpDist(credentials, (status, progress) => {
    ftpLogger.info({ status, progress }, 'Deploy progress');
  });

  res.json(response);
}));

export default router;
