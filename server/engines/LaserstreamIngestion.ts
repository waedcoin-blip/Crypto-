/**
 * Helius LaserStream Engine - Direct In-Process gRPC Ingestion & Normalization
 *
 * Architecture:
 *   Helius LaserStream gRPC (helius-laserstream v0.8.4+)
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

import {
  subscribe,
  CommitmentLevel,
  type LaserstreamConfig,
  type SubscribeRequest,
  type SubscribeUpdate,
  type StreamHandle,
  shutdownAllStreams,
} from 'helius-laserstream';
import tls from 'tls';
import { URL } from 'url';
import bs58 from 'bs58';
import { laserLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { laserStreamWatchdog } from '../services/LaserStreamWatchdog.js';
import type {
  LaserStreamOptions,
  LaserStreamStatus,
  LaserStreamNetwork,
  LaserStreamMode,
  LaserStreamHealthStatus,
  LaserStreamTelemetry,
  SseEvent,
} from '../types/index.js';

// ─── Network Endpoints & Program Filters ───
export const LASERSTREAM_ENDPOINTS = {
  mainnet: [
    'https://laserstream-mainnet-ams.helius-rpc.com', // Europe AMS (Amsterdam)
    'https://laserstream-mainnet-fra.helius-rpc.com', // Europe FRA (Frankfurt)
    'https://laserstream-mainnet-lon.helius-rpc.com', // Europe LON (London)
    'https://laserstream-mainnet-ewr.helius-rpc.com', // East US EWR (Newark)
    'https://laserstream-mainnet-tyo.helius-rpc.com', // Asia TYO (Tokyo)
    'https://laserstream-mainnet-sgp.helius-rpc.com', // Asia SGP (Singapore)
  ],
} as const;

export const DEFAULT_NETWORK_PROGRAMS: Record<LaserStreamNetwork, string[]> = {
  mainnet: [
    '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun Mainnet
    '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe', // Raydium AMM Mainnet
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6 Mainnet
  ],
};

const HUB_PROBE_TIMEOUT = 2_500;
const MAX_RECONNECT_ATTEMPTS = 10;

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
      this.queue.shift(); // Evict oldest to protect heap during spike
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
  const errMsg = err instanceof Error ? err.message : String(err);
  const lower = errMsg.toLowerCase();

  const isPlanError =
    lower.includes('unsupported plan') ||
    lower.includes('developer plan required') ||
    lower.includes('plan does not support') ||
    lower.includes('geyser access denied') ||
    lower.includes('upgrade your plan') ||
    lower.includes('business') ||
    lower.includes('tier limit') ||
    lower.includes('permission denied') ||
    lower.includes('403');

  const isAuthError =
    lower.includes('invalid api key') ||
    lower.includes('authentication credentials') ||
    lower.includes('unauthenticated') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid key') ||
    lower.includes('valid authentication') ||
    lower.includes('401');

  let userActionableMessage = errMsg;
  if (isPlanError) {
    userActionableMessage =
      'Helius LaserStream gRPC on Mainnet requires a Business or Professional plan. Your current Helius plan does not have Yellowstone gRPC access.';
  } else if (isAuthError) {
    userActionableMessage =
      'Invalid Helius API Key provided. Please verify your HELIUS_API_KEY credentials in settings.';
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
  let rawSig = txData?.signatures?.[0] || txData?.signature;
  if (!rawSig && (txInfo as any).signature) {
    rawSig = (txInfo as any).signature;
  }
  const signature = toBase58(rawSig);
  if (!signature) return null;

  // Extract account keys from message
  const rawAccountKeys = txData?.transaction?.message?.accountKeys || [];
  const accountKeys = rawAccountKeys.map((k: any) => toBase58(k)).filter(Boolean);

  // Extract logs and meta
  const meta = txData?.meta;
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

// ─── Regional Hub Selection ───
async function probeHubLatency(hubUrl: string, timeoutMs = HUB_PROBE_TIMEOUT): Promise<number> {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(hubUrl);
      const host = parsedUrl.hostname;
      const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 443;
      const start = Date.now();

      const socket = tls.connect(port, host, { servername: host, timeout: timeoutMs }, () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve(latency);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(Infinity);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(Infinity);
      });
    } catch {
      resolve(Infinity);
    }
  });
}

export async function getFastestRegionalHub(
  network: LaserStreamNetwork = 'mainnet',
  excludeHubs: Set<string> = new Set()
): Promise<string | null> {
  const candidateHubs = (LASERSTREAM_ENDPOINTS[network] || LASERSTREAM_ENDPOINTS.mainnet).filter(
    (h) => !excludeHubs.has(h)
  );

  if (candidateHubs.length === 0) return null;

  laserLogger.info(
    { network, candidates: candidateHubs.length },
    'Probing regional LaserStream hubs for lowest gRPC latency'
  );

  const results = await Promise.all(
    candidateHubs.map(async (url) => {
      const latency = await probeHubLatency(url);
      laserLogger.debug({ hub: url, latency }, 'LaserStream hub TLS probe result');
      return { url, latency };
    })
  );

  const validResults = results.filter((r) => Number.isFinite(r.latency));
  if (validResults.length === 0) {
    laserLogger.warn('All hub TLS probes timed out, defaulting to primary hub');
    return candidateHubs[0];
  }

  validResults.sort((a, b) => a.latency - b.latency);
  const fastest = validResults[0];

  laserLogger.info({ hub: fastest.url, latency: fastest.latency, network }, 'Selected optimal LaserStream regional hub');
  return fastest.url;
}

// ─── Main Stream Start (In-Process Persistent gRPC) ───
export async function startLaserStream(
  options: LaserStreamOptions,
  eventBusCallback: (event: SseEvent) => void
): Promise<StreamHandle | null> {
  const sessionId = ++state.currentSessionId;
  const network = options.network || 'mainnet';
  const apiKey = sanitizeApiKey(options.apiKey || config.HELIUS_API_KEY || '');
  const programs =
    options.programAddresses && options.programAddresses.length > 0
      ? options.programAddresses
      : DEFAULT_NETWORK_PROGRAMS[network];

  state.currentOptions = options;
  state.network = network;
  state.eventBusCallback = eventBusCallback;

  // Cleanly stop any existing stream handle
  if (state.activeStreamHandle) {
    try {
      state.activeStreamHandle.cancel();
    } catch {}
    state.activeStreamHandle = null;
  }
  asyncEventProcessor.clear();

  // Validate API key upfront - fail loudly
  if (!apiKey) {
    const errorMsg = 'Helius API Key is required for LaserStream gRPC streaming.';
    laserLogger.warn(errorMsg);
    laserStreamWatchdog.recordError(errorMsg);
    laserStreamWatchdog.setTransportState(false, null, 'disabled', network);
    return null;
  }

  // Auto-select fastest regional endpoint
  let endpoint = options.endpoint || 'auto';
  if (endpoint === 'auto' || !endpoint.includes('http')) {
    const fastestHub = await getFastestRegionalHub(network);
    endpoint = fastestHub || LASERSTREAM_ENDPOINTS.mainnet[0];
  }

  state.mode = 'grpc';
  state.activeEndpoint = endpoint;
  state.transportConnected = false;

  laserStreamWatchdog.setTransportState(false, endpoint, 'grpc', network);
  laserLogger.info(
    { endpoint, network, programFilters: programs.length },
    'Connecting directly to Helius LaserStream gRPC (in-process)'
  );

  const laserConfig: LaserstreamConfig = {
    apiKey,
    endpoint,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    replay: true,
  };

  const subscriptionRequest: SubscribeRequest = {
    commitment: CommitmentLevel.CONFIRMED,
    transactions: {
      'network-transactions': {
        accountInclude: programs,
        vote: false,
        failed: false,
      },
    },
    slots: {
      'slots-stream': {
        filterByCommitment: true,
      },
    },
  };

  try {
    const handle = await subscribe(
      laserConfig,
      subscriptionRequest,
      (update: SubscribeUpdate) => {
        if (state.currentSessionId !== sessionId) return;

        // Slot notification
        if (update.slot) {
          const slotNum = Number(update.slot.slot || 0);
          if (slotNum > 0) {
            laserStreamWatchdog.recordReceivedEvent(slotNum);
          }
        }

        // Heartbeat / ping / pong
        if (update.ping || update.pong) {
          laserStreamWatchdog.recordHeartbeat();
        }

        // Transaction notification
        if (update.transaction) {
          const standardEvent = normalizeLaserstreamTransaction(update, network);
          if (standardEvent && standardEvent.signature) {
            const dedupeKey = `${network}:${standardEvent.slot}:${standardEvent.signature}`;
            if (!signatureDeduplicator.add(dedupeKey)) return;

            state.transportConnected = true;
            laserStreamWatchdog.setTransportState(true, state.activeEndpoint, 'grpc', network);
            laserStreamWatchdog.recordReceivedEvent(Number(standardEvent.slot || 0));

            standardEvent.endpoint = state.activeEndpoint;

            asyncEventProcessor.enqueue(standardEvent, eventBusCallback);
          }
        }
      },
      (error: unknown) => {
        if (state.currentSessionId !== sessionId) return;

        const parsed = parseHeliusError(error);
        laserLogger.error(
          { error: parsed.message, userNotice: parsed.userActionableMessage },
          'LaserStream gRPC error encountered'
        );
        laserStreamWatchdog.recordError(parsed.userActionableMessage);

        if (parsed.isPlanError || parsed.isAuthError) {
          state.transportConnected = false;
          laserStreamWatchdog.setTransportState(false, state.activeEndpoint, 'grpc', network);
        }
      }
    );

    state.activeStreamHandle = handle;
    state.transportConnected = true;
    laserStreamWatchdog.setTransportState(true, endpoint, 'grpc', network);
    laserStreamWatchdog.recordError(null);
    laserLogger.info({ endpoint, network }, 'Helius LaserStream gRPC stream established');

    return handle;
  } catch (err: unknown) {
    const parsed = parseHeliusError(err);
    laserLogger.error(
      { error: parsed.message, userNotice: parsed.userActionableMessage },
      'Failed to initialize Helius LaserStream gRPC stream'
    );
    state.transportConnected = false;
    laserStreamWatchdog.recordError(parsed.userActionableMessage);
    laserStreamWatchdog.setTransportState(false, endpoint, 'grpc', network);
    return null;
  }
}

// ─── Stop Stream ───
export async function stopLaserStream(): Promise<void> {
  state.currentSessionId++;

  if (state.activeStreamHandle) {
    try {
      state.activeStreamHandle.cancel();
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

  try {
    shutdownAllStreams();
  } catch {}

  laserLogger.info('Helius LaserStream gRPC engine cleanly stopped');
}
