/**
 * Centralized configuration with validation
 */
import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const configSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Security
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) => s.split(',').map((o) => o.trim())),
  API_RATE_LIMIT: z.coerce.number().default(120),
  SWAP_RATE_LIMIT: z.coerce.number().default(20),

  // API Keys
  JUPITER_API_KEY: z.string().optional(),
  VITE_JUPITER_API_KEY: z.string().optional(),
  HELIUS_API_KEY: z.string().optional(),
  VITE_HELIUS_API_KEY: z.string().optional(),

  // FTP
  ALLOWED_FTP_HOSTS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((h) => h.trim()).filter(Boolean)),

  // Feature Flags
  ENABLE_SIMULATED_TOKENS: z.coerce.boolean().default(false),

  // Vercel (auto-detected)
  VERCEL: z.string().optional(),
  VERCEL_REGION: z.string().optional(),

  // Worker mode
  IS_LASERSTREAM_WORKER: z.string().optional(),
  VITE_DEV_SERVER: z.string().optional(),
});

const parsedResult = configSchema.safeParse(process.env);

if (!parsedResult.success) {
  console.error('❌ Invalid configuration:', parsedResult.error.format());
  process.exit(1);
}

const parsedConfig = parsedResult.data;

export const IS_PRODUCTION = parsedConfig.NODE_ENV === 'production';
export const IS_DEVELOPMENT = parsedConfig.NODE_ENV === 'development';
export const IS_VERCEL = Boolean(parsedConfig.VERCEL || parsedConfig.VERCEL_REGION);
export const IS_WORKER = parsedConfig.IS_LASERSTREAM_WORKER === 'true';

export const config = {
  ...parsedConfig,
  IS_PRODUCTION,
  IS_DEVELOPMENT,
  IS_VERCEL,
  IS_WORKER,
};

// API key resolution helpers
export function getJupiterApiKey(reqKey?: string): string | undefined {
  return reqKey || config.JUPITER_API_KEY || config.VITE_JUPITER_API_KEY;
}

export function getHeliusApiKey(): string | undefined {
  return config.HELIUS_API_KEY || config.VITE_HELIUS_API_KEY;
}
