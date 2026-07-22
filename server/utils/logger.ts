/**
 * Structured logging with Pino
 */
import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: config.NODE_ENV === 'development' 
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base: {
    pid: process.pid,
    env: config.NODE_ENV,
  },
});

// Child loggers for specific modules
export const jupiterLogger = logger.child({ module: 'jupiter' });
export const dexLogger = logger.child({ module: 'dexscreener' });
export const laserLogger = logger.child({ module: 'laserstream' });
export const ftpLogger = logger.child({ module: 'ftp' });
export const securityLogger = logger.child({ module: 'security' });
