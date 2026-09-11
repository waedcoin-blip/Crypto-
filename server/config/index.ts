/**
 * Centralized configuration with strict Zod validation
 */
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: '.env.local' });
dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  NETWORK: z.enum(['mainnet', 'devnet']).default('mainnet'),

  ALLOWED_ORIGINS: z.string().default('http://localhost:3000')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  API_RATE_LIMIT: z.coerce.number().default(120),
  SWAP_RATE_LIMIT: z.coerce.number().default(20),
  PIPELINE_API_SECRET: z.string().optional(),

  JUPITER_API_KEY: z.string().optional(),
  VITE_JUPITER_API_KEY: z.string().optional(),
  HELIUS_API_KEY: z.string().optional(),
  VITE_HELIUS_API_KEY: z.string().optional(),

  HELIUS_STREAM_TRANSPORT: z.enum(['wss', 'grpc', 'auto']).default('wss'),
  HELIUS_WSS_URL: z.string().optional(),
  HELIUS_WSS_ENABLED: z.coerce.boolean().default(true),
  HELIUS_WSS_HEARTBEAT_MS: z.coerce.number().default(60000),
  HELIUS_WSS_RECONNECT_MAX_MS: z.coerce.number().default(60000),
  HELIUS_WSS_STALE_TIMEOUT_MS: z.coerce.number().default(120000),

  YELLOWSTONE_GRPC_ENDPOINT: z.string().optional(),
  YELLOWSTONE_GRPC_DEVNET_ENDPOINT: z.string().optional(),
  YELLOWSTONE_GRPC_X_TOKEN: z.string().optional(),

  SEARCH_RPC_URL: z.string().optional(),
  SEARCH_RPC_BACKUP_URL: z.string().optional(),
  SEARCH_WS_URL: z.string().optional(),
  SEARCH_WS_BACKUP_URL: z.string().optional(),
  MONITOR_RPC_URL: z.string().optional(),
  MONITOR_RPC_BACKUP_URL: z.string().optional(),
  MONITOR_WS_URL: z.string().optional(),
  MONITOR_WS_BACKUP_URL: z.string().optional(),
  EXECUTION_RPC_URL: z.string().optional(),
  EXECUTION_RPC_BACKUP_URL: z.string().optional(),
  EXECUTION_WS_URL: z.string().optional(),
  EXECUTION_WS_BACKUP_URL: z.string().optional(),

  ALLOWED_FTP_HOSTS: z.string().default('')
    .transform((s) => s.split(',').map((h) => h.trim()).filter(Boolean)),

  ENABLE_SIMULATED_TOKENS: z.coerce.boolean().default(false),
  VERCEL: z.string().optional(),
  VERCEL_REGION: z.string().optional(),
  IS_LASERSTREAM_WORKER: z.string().optional(),
  IS_TRADING_WORKER: z.string().optional(),
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
export const IS_WORKER = parsedConfig.IS_LASERSTREAM_WORKER === 'true' || parsedConfig.IS_TRADING_WORKER === 'true';

export const config = { ...parsedConfig, IS_PRODUCTION, IS_DEVELOPMENT, IS_VERCEL, IS_WORKER };

export function getJupiterApiKey(clientKey?: string): string | undefined {
  return clientKey || config.JUPITER_API_KEY || config.VITE_JUPITER_API_KEY;
}

export function getHeliusApiKey(): string | undefined {
  const raw = config.HELIUS_API_KEY || config.VITE_HELIUS_API_KEY;
  if (!raw) return undefined;
  // FIX: Added underscore to regex for full API-key character support
  if (raw.includes('api-key=')) {
    const match = raw.match(/api-key=([a-zA-Z0-9-_]+)/);
    if (match && match[1]) return match[1];
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const u = new URL(raw);
      return u.searchParams.get('api-key') || raw;
    } catch { /* fallback */ }
  }
  return raw;
}

export function getHeliusWssUrl(network: 'mainnet' | 'devnet' = config.NETWORK): string | undefined {
  if (config.HELIUS_WSS_URL && config.HELIUS_WSS_URL.trim()) return config.HELIUS_WSS_URL.trim();
  const key = getHeliusApiKey();
  if (!key) return undefined;
  const domain = network === 'devnet' ? 'devnet.helius-rpc.com' : 'mainnet.helius-rpc.com';
  return `wss://${domain}/?api-key=${encodeURIComponent(key)}`;
}