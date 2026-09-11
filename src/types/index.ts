// src/types/index.ts

// ==========================================
// TOKEN & MARKET DATA TYPES
// ==========================================

export interface TokenMetric {
  address: string;
  symbol: string;
  name?: string;
  buyCount: number;
  sellCount: number;
  buyVolume: number;
  sellVolume: number;
  percentageIncrease: number;
  lastUpdated: number;
  discoveredAt: number;
  recentBuysTimeline: {
    t: number;
    a: number;
    w?: string;
    type?: 'buy' | 'sell' | 'BUY' | 'SELL';
  }[];
  latestAlert?: 'VOLUME_SPIKE' | 'WHALE_BUY' | 'HIGH_BUY' | 'MIGRATED' | 'NORMAL' | 'GOLDEN_CROSS' | 'TRENDING';
  whaleEntranceTime?: number;
  priceUsd?: number;
  priceNative?: number;
  marketCap?: number;
  liquidity?: number;
  bondingCurveProgress?: number;
  isRaydiumListed?: boolean;
  dexId?: string;
  riskScore?: number;
  devOwnership?: number;
  top10Holders?: number;
  ageMinutes?: number;
  volume24h?: number;
  priceChange1m?: number;
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  devWalletPercentage?: number;
  top10Percentage?: number;
  isRugSafe?: boolean;
  pairCreatedAt?: number;
  uniqueWalletsCount?: number;
  uniqueWallets?: any;
  holderCount?: number;
  buyRatio?: number;
  prevBuyCount?: number;
  prevHolderCount?: number;
  category?: string;
  mintAuthorityRevoked?: boolean;
  freezeAuthorityRevoked?: boolean;
  liquidityBurned?: boolean;
  holdersPerMin?: number;
  socialMentionsGrowth?: number;
  socialSentiment?: any;
  botRisk?: any;
  isAiAgentControlled?: boolean;
  liquidityRatio?: number;
  holderGrowthHr?: number;
  supply?: number;
  isSurging?: boolean;
  volMcRatio?: number;
  lastPrice?: number;
  devWalletOwnershipPct?: number;
  top10HoldersPct?: number;
  hasLowLiquidity?: boolean;
  isSellable?: boolean;
  mintAddress?: string;
  isVerified?: boolean;
  requiresManualReview?: boolean;
}

export interface TokenPrice {
  mint: string;
  priceUsd: number | null;
  priceNative: number | null;
  priceChange24h: number;
  updatedAt: number;
  source: 'jupiter' | 'dexscreener' | 'failed' | 'cache';
  isStale: boolean;
  error?: string;
}

export interface TokenStageInfo {
  isBonding: boolean;
  isMigrated: boolean;
  isNewListing: boolean;
  isNearMigration: boolean;
  stage: 'BONDING' | 'MIGRATED' | 'UNKNOWN';
  platform: string;
  bondingProgress: number;
}

// ==========================================
// TRADE & POSITION TYPES
// ==========================================

export interface Trade {
  id: string;
  signature?: string;
  orderId?: string;
  mint?: string;
  symbol?: string;
  type: 'buy' | 'sell' | 'BUY' | 'SELL';
  amount: number;
  amountRaw?: string;
  solAmount?: number;
  priceSol?: number;
  priceUsd?: number;
  wallet?: string;
  network?: string;
  timestamp: number | string;
  pnlSol?: number;
  pnlPct?: number;
  status?: 'pending' | 'confirmed' | 'failed';
  source?: string;
  tokenAddress?: string;
  token?: string;
  fromAccount?: string;
  entryPrice?: number;
  address?: string;
  amountInUsd?: number;
}

export interface SniperTrade extends Trade {
  entryPrice?: number;
  exitPrice?: number;
  holdDuration?: number;
  exitReason?: 'TP' | 'SL' | 'TRAILING_STOP' | 'MANUAL' | 'MAX_HOLD';
  address?: string;
  token?: string;
}

export interface Position {
  mint: string;
  symbol: string;
  network: string;
  wallet: string;
  amount: number;
  amountRaw?: string;
  avgEntryPrice: number;
  totalCostSol: number;
  currentPriceSol: number;
  unrealizedPnlSol: number;
  unrealizedPnlPct: number;
  realizedPnlSol?: number;
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  openedAt: number;
  updatedAt: number;
  status: 'open' | 'closed' | 'pending';
  buySignature?: string;
  sellSignature?: string;
}

// ==========================================
// TELEMETRY & ALERT TYPES
// ==========================================

export type TelemetryAlertType =
  | 'VOLUME_SPIKE'
  | 'WHALE_BUY'
  | 'HIGH_FREQUENCY_BUY'
  | 'HIGH_BUY'
  | 'MIGRATED'
  | 'GOLDEN_CROSS'
  | 'WALLET_TRADE'
  | 'RUG_RISK_DETECTED'
  | 'LIQUIDITY_WARNING'
  | 'NEW_TOKEN'
  | 'TRENDING';

export interface TelemetryAlert {
  id: string;
  type: TelemetryAlertType;
  token: string;
  address: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

// ==========================================
// MARKET EVENT TYPES
// ==========================================

export type EventSource =
  | 'PULSE_FEED'
  | 'LASERSTREAM'
  | 'HELIUS_WSS'
  | 'HELIUS_GRPC'
  | 'YELLOWSTONE_GRPC'
  | 'SOLANA_RPC'
  | 'PUMP_FUN'
  | 'DEXSCREENER'
  | 'MANUAL'
  | 'SIMULATION';

export type MarketEventType = 'TRADE' | 'BUY' | 'SELL' | 'TOKEN_DISCOVERED' | 'MIGRATION' | 'BONDING_TRADE' | string;

export interface UnifiedMarketEvent {
  eventId: string;
  correlationId: string;
  chain: 'solana';
  source: EventSource;
  mint: string;
  signature?: string;
  slot?: number;
  timestamp: number;
  eventType: MarketEventType;
  side?: 'buy' | 'sell' | 'BUY' | 'SELL';
  tokenAmount?: string;
  tokenAmountRaw?: string;
  solAmount?: string;
  solAmountRaw?: string;
  priceSol?: number;
  buyer?: string;
  seller?: string;
  confidence?: number;
  symbol?: string;
  pool?: string;
  protocol?: string;
  network?: string;
  raw?: any;
  accountKeys?: string[];
}

// ==========================================
// CRITERIA & CONFIG TYPES
// ==========================================

export interface CriteriaCheck {
  ruleId: string;
  name: string;
  passed: boolean;
  observedValue?: any;
  threshold?: any;
  reason?: string;
}

export interface TradeCandidate {
  mint: string;
  symbol: string;
  score: number;
  reasons: string[];
  metrics: Partial<TokenMetric>;
}

export type CandidateLifecycleState = 'DISCOVERED' | 'ENRUNCHED' | 'SCORED' | 'PASSED' | 'REJECTED' | 'EXECUTED' | 'BUYING' | 'BOUGHT' | string;

export interface CandidatePipelineRecord {
  mint: string;
  symbol: string;
  state: CandidateLifecycleState;
  timestamp?: number;
  details?: Record<string, any>;
  network?: string;
  lastEventAt?: number;
  pool?: string;
  sources?: string[];
  score?: number;
  rejectionReason?: string;
  buyOrderId?: string;
  buySignature?: string;
  positionId?: string;
  [key: string]: any;
}

// ==========================================
// CACHE TYPES
// ==========================================

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface CacheHit<T> {
  data: T;
  isStale: boolean;
}

// ==========================================
// HARDENED APPROVAL TYPES
// ==========================================

export type HardenedDecision = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface HardenedCriterionResult {
  ruleId: string;
  name: string;
  status: HardenedDecision;
  passed: boolean;
  reason?: string;
  observedValue?: any;
  threshold?: any;
}

export interface HardenedApproval {
  approvalId: string;
  chain: 'solana';
  mint: string;
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
  pool?: string;
  consumedByOrderId?: string;
  consumedAt?: number;
}

// ==========================================
// EXIT TYPES
// ==========================================

export interface ExitPreCheckResult {
  valid: boolean;
  reason: string;
  mint?: string;
  marketPriceSol?: number;
  executablePriceSol?: number;
  priceDivergencePct?: number;
  routeAvailable?: boolean;
  rawBalance?: any;
  quote?: any;
  timestamp?: number;
}

export interface ExitDecision {
  shouldExit: boolean;
  reason: 'TP' | 'SL' | 'TRAILING_STOP' | 'MANUAL' | 'NONE';
  currentPnlPct: number;
  message: string;
}

// ==========================================
// SERVER & SERVICE EXTENSION TYPES
// ==========================================

export interface SourceHealthStats {
  source?: string;
  healthy?: boolean;
  latencyMs?: number;
  lastEventAt?: number;
  errorCount?: number;
  connected?: boolean;
  eventsPerSec?: number;
  status?: string;
  totalEventsReceived?: number;
  candidatesDiscovered?: number;
  qualifiedCount?: number;
  buyAttempts?: number;
  buysConfirmed?: number;
  buysFailed?: number;
  lastError?: string;
  rejectionsCount?: number;
  [key: string]: any;
}

export interface DexTokenResponse {
  pairs?: DexPair[];
  schemaVersion?: string;
}

export interface TokenProfile {
  url?: string;
  chainId?: string;
  tokenAddress?: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: any[];
}

export interface HealthCheck {
  status: 'ok' | 'degraded' | 'down';
  timestamp: number;
  uptime?: number;
  services?: Record<string, any>;
}

export interface JupiterPriceResponse {
  data?: Record<string, { id: string; price: string; type?: string }>;
  timeTaken?: number;
}

export interface SseClient {
  id: string;
  res: any;
  connectedAt: number;
}

export interface LaserStreamOptions {
  network?: string;
  apiKey?: string;
  endpoint?: string;
  programAddresses?: string[];
}

export interface LaserStreamStatus {
  active: boolean;
  clientsCount: number;
  connectedAt?: number;
  network?: string;
  options?: any;
  isFallback?: boolean;
  isSimulated?: boolean;
  activeEndpoint?: string;
  telemetry?: any;
}

export interface SseEvent {
  event?: string;
  data?: any;
  [key: string]: any;
}

export interface RpcProbeResult {
  url: string;
  status?: 'HEALTHY' | 'DEGRADED' | 'DOWN' | string;
  latencyMs?: number;
  latency?: number;
  ok?: boolean;
  error?: string;
  slot?: number;
}

export type LaserStreamHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | string;

export interface LaserStreamTelemetry {
  eventsPerSec: number;
  totalEvents: number;
  errorRate: number;
  status?: any;
  transportConnected?: boolean;
  slotLag?: number;
  processingLagMs?: number;
  queueDepth?: number;
  lastReceivedSlot?: number;
  lastProcessedSlot?: number;
  ingestionState?: string;
  connectedAt?: number;
  lastHeartbeatAt?: number;
  lastEventAt?: number;
  isReplaying?: boolean;
  replayFromSlot?: number;
  eventsReceived?: number;
}

export type LaserStreamMode = 'STANDALONE' | 'INTEGRATED' | 'SIMULATION' | 'grpc' | string;
export type LaserStreamNetwork = 'mainnet' | 'devnet' | 'testnet' | string;

export interface FtpCredentials {
  host?: string;
  user?: string;
  password?: string;
  pass?: string;
  port?: number;
  secure?: boolean;
  dir?: string;
}

export interface FtpResult {
  success: boolean;
  message?: string;
  path?: string;
}

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name?: string; symbol: string };
  quoteToken: { address: string; name?: string; symbol: string };
  priceNative: string;
  priceUsd?: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: any;
  fdv?: number;
  marketCap?: number;
  info?: any;
}

export interface SimulatedTokenInfo {
  mint?: string;
  symbol: string;
  name?: string;
  initialPriceSol?: number;
  currentPriceSol?: number;
  imageUrl?: string;
  address?: string;
}
