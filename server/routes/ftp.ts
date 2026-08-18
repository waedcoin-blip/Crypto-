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

// Require strict admin API Key for all FTP routes
router.use((req, res, next) => {
  const apiKey = req.headers['x-admin-api-key'];
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    ftpLogger.warn({ ip: req.ip }, 'Unauthorized FTP administration access attempt');
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin API Key' });
  }
  next();
});

function getCredentials() {
  const credentials = {
    host: process.env.FTP_HOST || '',
    user: process.env.FTP_USER || '',
    pass: process.env.FTP_PASS || '',
    dir: process.env.FTP_DIR || '/htdocs',
    secure: process.env.FTP_SECURE === 'true'
  };

  if (!credentials.host || !credentials.user || !credentials.pass) {
    throw new UnauthorizedError('FTP credentials are not configured on the server');
  }
  
  if (config.ALLOWED_FTP_HOSTS.length === 0) {
    ftpLogger.warn({ host: credentials.host }, 'FTP host rejected: ALLOWED_FTP_HOSTS is empty');
    throw new UnauthorizedError('FTP deployment is disabled on this server (allowlist is empty)');
  }
  
  if (!config.ALLOWED_FTP_HOSTS.includes(credentials.host)) {
    ftpLogger.warn({ host: credentials.host }, 'FTP host not in allowlist');
    throw new UnauthorizedError('Host not in allowlist');
  }

  return credentials;
}

// POST /api/hosting/test
router.post('/test', asyncHandler(async (req, res) => {
  const credentials = getCredentials();
  const response = await testFtpConnection(credentials);
  res.json(response);
}));

// POST /api/hosting/backup
router.post('/backup', asyncHandler(async (req, res) => {
  const credentials = getCredentials();

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
  const credentials = getCredentials();

  const response = await deployFtpDist(credentials, (status, progress) => {
    ftpLogger.info({ status, progress }, 'Deploy progress');
  });

  res.json(response);
}));

export default router;
