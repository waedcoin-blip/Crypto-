/**
 * TypeScript interfaces and types for the server
 */

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface CacheHit<T> {
  data: T;
  isStale: boolean;
}

export interface FtpCredentials {
  host: string;
  user: string;
  pass: string;
  dir: string;
  secure?: boolean;
}

export interface FtpResult {
  success: boolean;
  message: string;
}

export interface BackupData {
  positions: unknown;
  stats: unknown;
  logs: string;
  timestamp: string;
}

export interface HealthCheck {
  status: 'healthy' | 'degraded';
  timestamp: string;
  uptime: number;
  checks: Record<string, string>;
}

export interface RpcProbeResult {
  url: string;
  latency: number;
  ok: boolean;
  slot?: number;
  error?: string;
}

export type LaserStreamNetwork = 'mainnet';
export type LaserStreamMode = 'grpc' | 'websocket' | 'simulation';
export type LaserStreamHealthStatus =
  | 'connected'
  | 'degraded'
  | 'stale'
  | 'disconnected'
  | 'replaying'
  | 'connecting'
  | 'disabled'
  | 'fallback'
  | 'simulated';

export interface LaserStreamTelemetry {
  transportConnected: boolean;
  connectedAt?: number | null;
  status: LaserStreamHealthStatus;
  ingestionState?: 'active' | 'idle' | 'replaying';
  lastHeartbeatAt: number | null;
  lastEventAt: number | null;
  lastReceivedSlot: number;
  lastProcessedSlot: number;
  slotLag: number;
  processingLagMs: number;
  queueDepth: number;
  isReplaying: boolean;
  replayFromSlot: number | null;
  eventsReceived: number;
  eventsProcessed: number;
  reconnectCount: number;
  network: LaserStreamNetwork;
  endpoint: string | null;
  mode: LaserStreamMode;
  errorMessage?: string | null;
}

export interface LaserStreamOptions {
  apiKey?: string;
  endpoint?: string;
  network?: LaserStreamNetwork;
  programAddresses?: string[];
  customWsUrl?: string;
}

export interface LaserStreamStatus {
  active: boolean;
  options: LaserStreamOptions;
  clientsCount: number;
  isFallback: boolean;
  isSimulated: boolean;
  activeEndpoint: string | null;
  network: LaserStreamNetwork;
  telemetry: LaserStreamTelemetry;
}

export interface SseClient {
  res: any;
  id: string;
  connectedAt: number;
}

export interface SseEvent {
  type: string;
  slot?: number;
  signature?: string;
  rawPayload?: unknown;
  isFallback?: boolean;
  isSimulated?: boolean;
  endpoint?: string | null;
  observationTimestamp?: number;
  [key: string]: unknown;
}

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: symbol | string };
  priceNative: string;
  priceUsd: string;
  txns?: Record<string, { buys: number; sells: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd: number; base: number; quote: number };
  fdv?: number;
  marketCap?: number;
  info?: { imageUrl?: string; websites?: any[]; socials?: any[] };
}

export interface DexTokenResponse {
  schemaVersion?: string;
  pairs?: DexPair[];
  [key: string]: unknown;
}

export interface TokenProfile {
  tokenAddress: string;
  chainId: string;
  url: string;
  icon: string;
  header: string;
  description: string;
  links: any[];
}

export interface SimulatedTokenInfo {
  name: string;
  symbol: string;
  imageUrl: string;
}

export interface JupiterPriceResponse {
  data: Record<string, { id: string; type: string; price: string }>;
  timeTaken?: number;
}
