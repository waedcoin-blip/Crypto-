/**
 * Yellowstone Geyser gRPC Engine - Direct In-Process Ingestion & Normalization
 *
 * Architecture:
 *   Yellowstone Geyser gRPC (@triton-one/yellowstone-grpc)
 *          ↓
 *   Single persistent in-process subscription
 *          ↓
 *   On-Chain Transaction Normalization (Base58 decoding, accounts, logs, slot)
 *          ↓
 *   Deduplication Cache
 *          ↓
 *   Async Non-Blocking Event Queue & Watchdog Metrics
 *          ↓
 *   Trading Monitor & SSE Broadcast
 */

import ClientPkg, {
  type SubscribeRequest,
  type SubscribeUpdate,
} from '@triton-one/yellowstone-grpc';
import tls from 'tls';
import { URL } from 'url';
import bs58 from 'bs58';
import { laserLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { laserStreamWatchdog, LASERSTREAM_ACTIVITY_STALE_MS } from '../services/LaserStreamWatchdog.js';

const Client = (ClientPkg as any).default || ClientPkg;
const CommitmentLevel = (ClientPkg as any).CommitmentLevel || { PROCESSED: 0, CONFIRMED: 1, FINALIZED: 2 };
import type {
  LaserStreamOptions,
  LaserStreamNetwork,
  LaserStreamMode,
  LaserStreamTelemetry,
  SseEvent,
} from '../types/index.js';

export type StreamHandle = {
  end: () => void;
  cancel: () => void;
  client: any;
  stream: any;
};

// ─── Network Endpoints & Program Filters ───
export const LASERSTREAM_ENDPOINTS = {
  mainnet: [
    process.env.YELLOWSTONE_GRPC_ENDPOINT || 'https://grpc.mainnet.helius-rpc.com:443',
  ],
  devnet: [
    process.env.YELLOWSTONE_GRPC_DEVNET_ENDPOINT || 'https://grpc.devnet.helius-rpc.com:443',
  ],
} as const;

export const DEFAULT_NETWORK_PROGRAMS: Record<LaserStreamNetwork, string[]> = {
  mainnet: [
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun Mainnet
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM Mainnet
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6 Mainnet
  ],
  devnet: [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ],
};

const HUB_PROBE_TIMEOUT = 2_500;
const MAX_RECONNECT_ATTEMPTS = 10;
export const STREAM_STALL_TIMEOUT_MS = LASERSTREAM_ACTIVITY_STALE_MS;

export function isStreamStalled(lastActivityAt: number): boolean {
  return lastActivityAt > 0 && Date.now() - lastActivityAt > STREAM_STALL_TIMEOUT_MS;
}

// ─── Base58 Binary Converter ───
export function toBase58(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Buffer.isBuffer(val) || val instanceof Uint8Array || Array.isArray(val)) {
    try {
      return bs58.encode(Uint8Array.from(val));
    } catch {
      return Buffer.from(val as any).toString('hex');
    }
  }
  return String(val);
}

export const toBase58Signature = toBase58;

// ─── LRU Deduplication Cache ───
class DeduplicationCache {
  private cache = new Map<string, number>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = 10_000, ttlMs = 300_000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  has(key: string): boolean {
    const ts = this.cache.get(key);
    if (!ts) return false;
    if (Date.now() - ts > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  add(key: string): boolean {
    if (this.has(key)) return false;
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, Date.now());
    return true;
  }

  clear(): void {
    this.cache.clear();
  }
}

export const signatureDeduplicator = new DeduplicationCache(10_000, 300_000);

// ─── Async Non-Blocking Event Processor ───
class AsyncEventProcessor {
  private queue: { event: SseEvent; callback: (event: SseEvent) => void }[] = [];
  private isProcessing = false;
  private maxQueueSize = 5_000;

  enqueue(event: SseEvent, callback: (event: SseEvent) => void): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }
    this.queue.push({ event, callback });
    laserStreamWatchdog.setQueueDepth(this.queue.length);
    this.drain();
  }

  private async drain(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      laserStreamWatchdog.setQueueDepth(this.queue.length);
      if (!item) break;

      const startTime = Date.now();
      try {
        item.callback(item.event);
      } catch (err) {
        laserLogger.error({ error: err }, 'Error in async event processor callback');
        laserStreamWatchdog.recordProcessingFailure();
      } finally {
        const slot = Number(item.event.slot || 0);
        const duration = Date.now() - startTime;
        laserStreamWatchdog.recordProcessedEvent(slot, duration);
      }

      if (this.queue.length % 25 === 0 && this.queue.length > 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    this.isProcessing = false;
  }

  clear(): void {
    this.queue = [];
    laserStreamWatchdog.setQueueDepth(0);
  }
}

const asyncEventProcessor = new AsyncEventProcessor();

// ─── Stream State ───
interface StreamState {
  currentSessionId: number;
  activeStreamHandle: StreamHandle | null;
  transportConnected: boolean;
  network: LaserStreamNetwork;
  mode: LaserStreamMode;
  activeEndpoint: string | null;
  currentOptions: LaserStreamOptions | null;
  eventBusCallback: ((event: SseEvent) => void) | null;
}

const state: StreamState = {
  currentSessionId: 0,
  activeStreamHandle: null,
  transportConnected: false,
  network: 'mainnet',
  mode: 'disabled',
  activeEndpoint: null,
  currentOptions: null,
  eventBusCallback: null,
};

// ─── Getters ───
export function isLaserStreamUsingFallback(): boolean { return false; }
export function isLaserStreamSimulated(): boolean { return false; }
export function getActiveLaserStreamEndpoint(): string | null { return state.activeEndpoint; }
export function getLaserStreamTelemetry(): LaserStreamTelemetry {
  return laserStreamWatchdog.getMetrics();
}

// ─── Watchdog Wiring ───
laserStreamWatchdog.setHealthCheckHandler(async () => {
  laserLogger.debug('Watchdog health check tick for LaserStream');
});

laserStreamWatchdog.setReconnectHandler(async (fromSlot: number) => {
  if (!state.currentOptions) return;
  laserLogger.info({ fromSlot }, 'Watchdog requesting LaserStream gRPC reconnect with historical replay');
  laserStreamWatchdog.recordReconnect();
  laserStreamWatchdog.setReplaying(true, fromSlot);

  const cb = state.eventBusCallback;
  if (!cb) {
    laserLogger.warn('No event bus callback available for reconnect');
    return;
  }

  try {
    await startLaserStream(state.currentOptions, cb);
  } catch (err) {
    laserLogger.error({ error: err, fromSlot }, 'Watchdog LaserStream reconnect failed');
    throw err;
  }
});

// ─── Helpers ───
export function sanitizeApiKey(rawKey?: string): string {
  if (!rawKey || !rawKey.trim()) return '';
  let k = rawKey.trim();
  if (k.includes('api-key=')) {
    try {
      const match = k.match(/api-key=([a-zA-Z0-9-]+)/);
      if (match && match[1]) {
        k = match[1];
      }
    } catch {}
  } else if (k.startsWith('http://') || k.startsWith('https://')) {
    try {
      const u = new URL(k);
      const param = u.searchParams.get('api-key');
      if (param) k = param;
    } catch {}
  }
  return k;
}

export function parseHeliusError(err: unknown): {
  isPlanError: boolean;
  isAuthError: boolean;
  message: string;
  userActionableMessage: string;
} {
  let errMsg = '';
  if (err instanceof Error) {
    errMsg = err.message || err.stack || String(err);
  } else if (typeof err === 'object' && err !== null) {
    try {
      errMsg = JSON.stringify(err);
    } catch {
      errMsg = String(err);
    }
  } else {
    errMsg = String(err);
  }

  const lower = errMsg.toLowerCase();

  const isPlanError =
    lower.includes('unsupported plan') ||
    lower.includes('developer plan required') ||
    lower.includes('plan does not support') ||
    lower.includes('geyser access denied') ||
    lower.includes('upgrade your plan') ||
    lower.includes('tier limit') ||
    lower.includes('subscription does not include') ||
    lower.includes('yellowstone grpc access') ||
    lower.includes('laserstream access denied') ||
    lower.includes('caller does not have permission') ||
    lower.includes('permission to execute') ||
    lower.includes('unsupported plan type');

  const isAuthError =
    lower.includes('invalid api key') ||
    lower.includes('authentication credentials') ||
    lower.includes('unauthenticated') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid key') ||
    lower.includes('valid authentication') ||
    lower.includes('401') ||
    lower.includes('permission denied');

  let userActionableMessage = errMsg;
  if (isPlanError) {
    userActionableMessage =
      'Yellowstone / Helius gRPC stream unavailable on current plan; standard on-chain discovery active.';
  } else if (isAuthError) {
    userActionableMessage =
      'Invalid API Key provided for gRPC streaming. Please verify your credentials.';
  }

  return { isPlanError, isAuthError, message: errMsg, userActionableMessage };
}

// ─── Transaction Normalization ───
export function normalizeLaserstreamTransaction(
  update: SubscribeUpdate,
  network: LaserStreamNetwork = 'mainnet'
): SseEvent | null {
  if (!update.transaction) return null;

  const txInfo = update.transaction;
  const txData = txInfo.transaction;
  const slot = Number(txInfo.slot || (update.slot ? update.slot.slot : 0) || 0);

  // Extract signature
  let rawSig = (txData as any)?.signatures?.[0] || (txInfo as any)?.signature || (txData as any)?.signature;
  if (!rawSig && (txInfo as any)?.signature) {
    rawSig = (txInfo as any).signature;
  }
  const signature = toBase58(rawSig);
  if (!signature) return null;

  // Extract account keys from message
  const rawAccountKeys =
    txData?.transaction?.message?.accountKeys ||
    (txData as any)?.message?.accountKeys ||
    [];
  const accountKeys = rawAccountKeys.map((k: any) => toBase58(k)).filter(Boolean);

  // Extract logs and meta
  const meta = txData?.meta || (txInfo as any)?.meta;
  const logMessages = meta?.logMessages || [];
  const err = meta?.err || null;

  return {
    type: 'ON_CHAIN_TX',
    slot,
    signature,
    accountKeys,
    logMessages,
    err,
    rawPayload: {
      slot,
      signature,
      transaction: txData,
    },
    isFallback: false,
    isSimulated: false,
    network,
    observationTimestamp: Date.now(),
  };
}

// ─── Hub / Endpoint Selection ───
export async function getFastestRegionalHub(
  network: LaserStreamNetwork = 'mainnet',
  excludeHubs: Set<string> = new Set()
): Promise<string | null> {
  const candidateHubs = (LASERSTREAM_ENDPOINTS[network] || LASERSTREAM_ENDPOINTS.mainnet).filter(
    (h) => Boolean(h) && !excludeHubs.has(h)
  );

  if (candidateHubs.length === 0) return null;
  return candidateHubs[0];
}

export function resolveYellowstoneEndpoint(options: LaserStreamOptions): string {
  const configured = String(options.endpoint || '').trim();
  if (configured && configured !== 'auto' && /^https?:\/\//i.test(configured)) return configured;

  const env = String(
    (options.network === 'devnet'
      ? process.env.YELLOWSTONE_GRPC_DEVNET_ENDPOINT
      : process.env.YELLOWSTONE_GRPC_ENDPOINT) || ''
  ).trim();
  if (env) return env;

  const apiKey = sanitizeApiKey(options.apiKey || config.HELIUS_API_KEY || '');
  if (apiKey) {
    return options.network === 'devnet'
      ? 'https://grpc.devnet.helius-rpc.com:443'
      : 'https://grpc.mainnet.helius-rpc.com:443';
  }

  throw new Error(
    `Yellowstone endpoint is required for ${options.network || 'mainnet'}. Set the appropriate YELLOWSTONE_GRPC_*_ENDPOINT or HELIUS_API_KEY.`
  );
}

// ─── Main Stream Start (In-Process Persistent gRPC) ───
export async function startLaserStream(
  options: LaserStreamOptions,
  eventBusCallback: (event: SseEvent) => void
): Promise<StreamHandle | null> {
  const sessionId = ++state.currentSessionId;
  const network: LaserStreamNetwork = options.network || 'mainnet';
  const apiKey = sanitizeApiKey(
    options.apiKey || process.env.YELLOWSTONE_GRPC_X_TOKEN || config.HELIUS_API_KEY || ''
  );
  const programs =
    options.programAddresses && options.programAddresses.length > 0
      ? options.programAddresses
      : DEFAULT_NETWORK_PROGRAMS[network] || [];

  state.currentOptions = options;
  state.network = network;
  state.eventBusCallback = eventBusCallback;

  // Cleanly stop any existing stream handle
  if (state.activeStreamHandle) {
    try {
      state.activeStreamHandle.cancel?.();
      state.activeStreamHandle.end?.();
    } catch {}
    state.activeStreamHandle = null;
  }
  asyncEventProcessor.clear();

  let endpoint: string;
  try {
    endpoint = resolveYellowstoneEndpoint(options);
  } catch (err: any) {
    const parsed = parseHeliusError(err);
    laserLogger.info({ error: parsed.message }, 'Yellowstone endpoint is not configured; gRPC disabled');
    laserStreamWatchdog.recordError(parsed.userActionableMessage);
    laserStreamWatchdog.setTransportState(false, null, 'disabled', network);
    return null;
  }

  state.mode = 'grpc';
  state.activeEndpoint = endpoint;
  state.transportConnected = false;

  laserStreamWatchdog.reset(false); // Set watchdog to connecting state
  laserStreamWatchdog.setTransportState(false, endpoint, 'grpc', network);
  laserLogger.info(
    { endpoint, network, programFilters: programs.length },
    'Connecting directly to Yellowstone Geyser gRPC'
  );

  try {
    const client = new Client(
      endpoint,
      apiKey || undefined,
      {
        grpcMaxDecodingMessageSize: 64 * 1024 * 1024,
      },
      {
        backoff: { initialIntervalMs: 100, multiplier: 2, maxRetries: MAX_RECONNECT_ATTEMPTS },
        slotRetention: 250,
      }
    );

    // Establish connection
    await client.connect();

    const request: SubscribeRequest = {
      accounts: {},
      slots: { 'slots-stream': { filterByCommitment: true } },
      transactions: {
        'network-transactions': {
          accountInclude: programs,
          accountExclude: [],
          accountRequired: [],
          vote: false,
          failed: false,
        },
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED,
      ping: undefined,
    };

    const stream = await client.subscribe();
    const handle: StreamHandle = {
      end: () => {
        try { stream.end(); } catch {}
        try { (client as any)?.close?.(); } catch {}
      },
      cancel: () => {
        try { (stream as any)?.cancel?.(); } catch {}
        try { (stream as any)?.destroy?.(); } catch {}
        try { stream.end(); } catch {}
        try { (client as any)?.close?.(); } catch {}
      },
      client,
      stream,
    };
    state.activeStreamHandle = handle;

    stream.on('data', (update: SubscribeUpdate) => {
      if (state.currentSessionId !== sessionId) return;
      laserStreamWatchdog.recordRawUpdate();

      if (!state.transportConnected) {
        state.transportConnected = true;
        laserStreamWatchdog.setTransportState(true, state.activeEndpoint, 'grpc', network);
      }

      if (update.slot) {
        const slotNum = Number(update.slot.slot || 0);
        if (slotNum > 0) {
          laserStreamWatchdog.recordReceivedEvent(slotNum);
        }
      }

      if (update.ping || update.pong) {
        laserStreamWatchdog.recordHeartbeat();
      }

      if (update.transaction) {
        const standardEvent = normalizeLaserstreamTransaction(update, network);
        if (standardEvent && standardEvent.signature) {
          const dedupeKey = `${network}:${standardEvent.slot}:${standardEvent.signature}`;
          if (!signatureDeduplicator.add(dedupeKey)) {
            laserStreamWatchdog.recordDuplicateUpdate();
            return;
          }

          laserStreamWatchdog.recordReceivedEvent(Number(standardEvent.slot || 0));
          standardEvent.endpoint = state.activeEndpoint;

          laserStreamWatchdog.recordQueuedUpdate();
          asyncEventProcessor.enqueue(standardEvent, eventBusCallback);
        } else {
          laserStreamWatchdog.recordRejectedUpdate();
        }
      }
    });

    stream.on('error', (error: unknown) => {
      if (state.currentSessionId !== sessionId) return;

      const parsed = parseHeliusError(error);
      state.transportConnected = false;

      if (parsed.isPlanError || parsed.isAuthError) {
        laserLogger.info(
          { error: parsed.message },
          'Helius gRPC plan/permission error; disabling gRPC stream reconnects.'
        );
        state.mode = 'disabled';
        if (state.activeStreamHandle) {
          try { state.activeStreamHandle.cancel(); } catch {}
          state.activeStreamHandle = null;
        }
        laserStreamWatchdog.recordError(parsed.userActionableMessage);
        laserStreamWatchdog.setDisabled(parsed.userActionableMessage);
      } else {
        laserLogger.error(
          { error: parsed.message, userNotice: parsed.userActionableMessage },
          'LaserStream gRPC error encountered'
        );
        laserStreamWatchdog.recordError(parsed.userActionableMessage);
        laserStreamWatchdog.setDisconnected();
      }
    });

    stream.on('end', () => {
      if (state.currentSessionId === sessionId) {
        state.transportConnected = false;
        laserStreamWatchdog.setDisconnected();
      }
    });

    stream.on('close', () => {
      if (state.currentSessionId === sessionId) {
        state.transportConnected = false;
        laserStreamWatchdog.setDisconnected();
      }
    });

    // Send subscription request over duplex stream
    await new Promise<void>((resolve, reject) => {
      stream.write(request, (err: Error | null | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });

    state.transportConnected = true;
    laserStreamWatchdog.setTransportState(true, endpoint, 'grpc', network);
    laserStreamWatchdog.recordError(null);
    laserLogger.info(
      { endpoint, network, programFilters: programs.length },
      'Yellowstone Geyser gRPC stream established'
    );

    return handle;
  } catch (err: unknown) {
    const parsed = parseHeliusError(err);
    state.transportConnected = false;

    if (parsed.isPlanError || parsed.isAuthError) {
      laserLogger.info(
        { error: parsed.message },
        'Helius gRPC plan/permission error on init; disabling gRPC stream reconnects.'
      );
      state.mode = 'disabled';
      if (state.activeStreamHandle) {
        try { state.activeStreamHandle.cancel(); } catch {}
        state.activeStreamHandle = null;
      }
      laserStreamWatchdog.recordError(parsed.userActionableMessage);
      laserStreamWatchdog.setDisabled(parsed.userActionableMessage);
    } else {
      laserLogger.info(
        { error: parsed.message, userNotice: parsed.userActionableMessage },
        'LaserStream gRPC unavailable'
      );
      laserStreamWatchdog.recordError(parsed.userActionableMessage);
      laserStreamWatchdog.setDisconnected();
    }
    return null;
  }
}

// ─── Stop Stream ───
export async function stopLaserStream(): Promise<void> {
  state.currentSessionId++;

  if (state.activeStreamHandle) {
    try {
      state.activeStreamHandle.cancel();
      state.activeStreamHandle.end();
    } catch {}
    state.activeStreamHandle = null;
  }

  asyncEventProcessor.clear();

  state.transportConnected = false;
  state.activeEndpoint = null;
  state.currentOptions = null;
  state.eventBusCallback = null;
  state.mode = 'disabled';

  laserStreamWatchdog.reset(true);

  laserLogger.info('Yellowstone Geyser gRPC engine cleanly stopped');
}
