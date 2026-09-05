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

export type LaserStreamNetwork = 'mainnet' | 'devnet';
export type LaserStreamMode = 'wss' | 'grpc' | 'disabled';
export type LaserStreamHealthStatus =
  | 'connected'
  | 'degraded'
  | 'stale'
  | 'disconnected'
  | 'replaying'
  | 'connecting'
  | 'disabled';

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
  /** v98 live-ingestion diagnostics */
  rawUpdatesReceived?: number;
  invalidUpdates?: number;
  rejectedUpdates?: number;
  duplicateUpdates?: number;
  queuedUpdates?: number;
  processingFailures?: number;
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

// ─── Unified Multi-Source Token Discovery Interfaces ───

export type EventSource =
  | 'PULSE_FEED'
  | 'LASERSTREAM'
  | 'HELIUS_WSS'
  | 'HELIUS_GRPC'
  | 'PUMP_FUN'
  | 'DEXSCREENER'
  | 'MANUAL'
  | 'SIMULATION';

export type MarketEventType =
  | 'TOKEN_DISCOVERED'
  | 'TRADE'
  | 'BUY'
  | 'SELL'
  | 'BONDING_TRADE'
  | 'MIGRATION'
  | 'LIQUIDITY'
  | 'PRICE_UPDATE'
  | 'ON_CHAIN_TX'
  | 'ACCOUNT_UPDATE'
  | 'SLOT_UPDATE';

export interface MintIdentity {
  chain: 'solana';
  mint: string;
}

export interface MarketIdentity {
  chain: 'solana';
  mint: string;
  pool: string;
}

export interface UnifiedMarketEvent {
  eventId: string;
  correlationId: string;
  chain: 'solana';
  source: string;
  mint: string;
  pool?: string;
  signature?: string;
  slot?: number;
  timestamp: number;
  eventType: string;
  side?: 'BUY' | 'SELL';
  tokenAmountRaw?: bigint | string;
  solAmountRaw?: bigint | string;
  tokenAmount?: string;
  solAmount?: string;
  priceSol?: number;
  buyer?: string;
  seller?: string;
  confidence?: number;
  raw?: unknown;
  network?: string;
  accountKeys?: string[];
  protocol?: string;
  symbol?: string;
}

export type HardenedDecision = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface HardenedCriterionResult {
  ruleId: string;
  name: string;
  passed: boolean;
  score?: number;
  observedValue?: any;
  threshold?: any;
  reason?: string;
  status: HardenedDecision;
}

export interface HardenedApproval {
  approvalId: string;
  chain: 'solana';
  mint: string;
  pool?: string;
  criteriaVersion: string;
  evaluatedAt: number;
  evaluatedSlot: number;
  evaluationPrice: number;
  maxSlotLag: number;
  maxPriceDeviationPct: number;
  expiresAt: number;
  checks: HardenedCriterionResult[];
  decisionHash: string;
  correlationId: string;
  state: 'ISSUED' | 'CONSUMING' | 'CONSUMED' | 'EXPIRED' | 'INVALID';
  consumedAt?: number;
  consumedByOrderId?: string;
}

export interface ExitPreCheckResult {
  valid: boolean;
  mint: string;
  pool?: string;
  marketPriceSol: number;
  executablePriceSol: number;
  priceDivergencePct: number;
  routeAvailable: boolean;
  rawBalance: number | bigint | string;
  quote?: any;
  reason?: string;
  timestamp: number;
}

export type CandidateLifecycleState =
  | 'DISCOVERED'
  | 'ANALYZING'
  | 'QUALIFIED'
  | 'BUY_AUTHORIZED'
  | 'BUYING'
  | 'BOUGHT'
  | 'REJECTED'
  | 'EXPIRED';

export interface CandidatePipelineRecord {
  mint: string;
  network: string;
  pool?: string;
  symbol: string;
  firstDiscoveredSource: EventSource;
  sources: EventSource[];
  firstDiscoveredAt: number;
  lastEventAt: number;
  state: CandidateLifecycleState;
  score?: number;
  rejectionReason?: string;
  buyOrderId?: string;
  buySignature?: string;
  positionId?: string;
  correlationId: string;
  metadata?: Record<string, any>;
}

export interface SourceHealthStats {
  source: EventSource;
  connected: boolean;
  status: 'ONLINE' | 'DEGRADED' | 'DISCONNECTED' | 'STALE';
  lastEventAt: number | null;
  eventsPerSec: number;
  totalEventsReceived: number;
  candidatesDiscovered: number;
  qualifiedCount: number;
  buyAttempts: number;
  buysConfirmed: number;
  buysFailed: number;
  rejectionsCount: number;
  errorCount: number;
  lastError?: string;
  latencyMs?: number;
}

