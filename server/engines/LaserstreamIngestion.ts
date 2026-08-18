/**
 * Helius LaserStream Engine - Network-Aware & Resilient
 * 
 * Features:
 * - Network-aware configuration (Devnet vs Mainnet)
 * - Yellowstone/LaserStream gRPC streaming via worker process isolation
 * - Network-matched High-Speed WebSocket fallback (Devnet & Mainnet)
 * - Generation / Session-ID guarded reconnect lifecycle (prevents duplicate streams)
 * - In-memory LRU signature deduplication (prevents duplicate trading triggers)
 * - Differentiated Transport Health vs Event Activity (no false-positive silence watchdog kills)
 * - Transparent error reporting with rate-limiting (no blind log suppression)
 */
import { subscribe, CommitmentLevel, type LaserstreamConfig, type SubscribeRequest, shutdownAllStreams } from 'helius-laserstream';
import { fork } from 'child_process';
import type { ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import tls from 'tls';
import { URL } from 'url';
import WebSocket from 'ws';
import { logger, laserLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
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
  devnet: [
    'https://laserstream-devnet-ams.helius-rpc.com',
    'https://laserstream-devnet-ewr.helius-rpc.com',
  ],
} as const;

export const DEFAULT_NETWORK_PROGRAMS: Record<LaserStreamNetwork, string[]> = {
  mainnet: [
    '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun Mainnet
    '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe', // Raydium AMM Mainnet
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6 Mainnet
  ],
  devnet: [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
    '11111111111111111111111111111111', // System Program
    'ComputeBudget111111111111111111111111111111', // Compute Budget Program
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', // Metaplex Token Metadata
  ],
};

const HEALTH_CHECK_INTERVAL = 15_000;  // 15s
const SIMULATION_INTERVAL = 2_000;     // 2s
const HUB_PROBE_TIMEOUT = 2_500;       // 2.5s
const MAX_RECONNECT_ATTEMPTS = 3;

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

// ─── State ───
interface StreamState {
  currentSessionId: number;
  activeSubscription: { cancel(): void; unsubscribe(): void } | null;
  childProcess: ChildProcess | null;
  fallbackRawWs: WebSocket | null;
  fallbackPingInterval: ReturnType<typeof setInterval> | null;
  fallbackReconnectTimer: ReturnType<typeof setTimeout> | null;
  healthCheckTimer: ReturnType<typeof setInterval> | null;
  simulationTimer: ReturnType<typeof setInterval> | null;
  
  // Status flags
  transportConnected: boolean;
  isUsingFallback: boolean;
  isSimulated: boolean;
  network: LaserStreamNetwork;
  mode: LaserStreamMode;
  status: LaserStreamHealthStatus;
  activeEndpoint: string | null;
  
  // Telemetry metrics
  lastHeartbeatTime: number | null;
  lastEventTime: number | null;
  lastSlot: number | null;
  eventsReceived: number;
  reconnectCount: number;
  errorMessage: string | null;
  fallbackBackoffMs: number;
}

const state: StreamState = {
  currentSessionId: 0,
  activeSubscription: null,
  childProcess: null,
  fallbackRawWs: null,
  fallbackPingInterval: null,
  fallbackReconnectTimer: null,
  healthCheckTimer: null,
  simulationTimer: null,

  transportConnected: false,
  isUsingFallback: false,
  isSimulated: false,
  network: 'devnet',
  mode: 'simulation',
  status: 'disabled',
  activeEndpoint: null,

  lastHeartbeatTime: null,
  lastEventTime: null,
  lastSlot: null,
  eventsReceived: 0,
  reconnectCount: 0,
  errorMessage: null,
  fallbackBackoffMs: 3_000,
};

// ─── Getters ───
export function isLaserStreamUsingFallback(): boolean { return state.isUsingFallback; }
export function isLaserStreamSimulated(): boolean { return state.isSimulated; }
export function getActiveLaserStreamEndpoint(): string | null { return state.activeEndpoint; }
export function getLaserStreamTelemetry(): LaserStreamTelemetry {
  return {
    transportConnected: state.transportConnected,
    status: state.status,
    lastHeartbeatAt: state.lastHeartbeatTime,
    lastEventAt: state.lastEventTime,
    lastSlot: state.lastSlot,
    eventsReceived: state.eventsReceived,
    reconnectCount: state.reconnectCount,
    network: state.network,
    endpoint: state.activeEndpoint,
    mode: state.mode,
    errorMessage: state.errorMessage,
  };
}

// ─── Helpers ───
export function getHeliusWsUrl(network: LaserStreamNetwork = 'devnet', apiKey = '', customWsUrl?: string): string {
  if (customWsUrl?.trim()) return customWsUrl.trim();
  const host = network === 'devnet' ? 'devnet.helius-rpc.com' : 'mainnet.helius-rpc.com';
  const key = apiKey?.trim() || config.HELIUS_API_KEY || '';
  return key && !isFreeOrDefaultKey(key)
    ? `wss://${host}/?api-key=${encodeURIComponent(key)}`
    : `wss://${host}`;
}

export function isFreeOrDefaultKey(key?: string): boolean {
  if (!key) return true;
  const k = key.trim().toLowerCase();
  return (
    k === 'e161791f-b336-40b9-80d6-f4c9f626833c' ||
    k === '98ec7a83-f29a-4ead-aaa3-3f288daf43b7' ||
    k === 'b422aec3-82c7-425c-a409-a48e744829ad' ||
    k === 'your_helius_api_key' ||
    k === 'default' ||
    k === 'free' ||
    k.length < 10
  );
}

export function isPlanError(errorMsg?: string): boolean {
  if (!errorMsg || !errorMsg.trim()) return false;
  const lower = errorMsg.toLowerCase();
  return (
    lower.includes('unsupported plan') ||
    lower.includes('developer plan required') ||
    lower.includes('plan does not support') ||
    lower.includes('geyser access denied') ||
    lower.includes('upgrade your plan') ||
    lower.includes('tier limit')
  );
}

const logRateLimitMap = new Map<string, number>();
function rateLimitedLog(level: 'info' | 'warn' | 'error', message: string, meta?: any, intervalMs = 10_000): void {
  const now = Date.now();
  const last = logRateLimitMap.get(message) || 0;
  if (now - last > intervalMs) {
    logRateLimitMap.set(message, now);
    if (level === 'error') {
      laserLogger.error(meta || {}, message);
    } else if (level === 'warn') {
      laserLogger.warn(meta || {}, message);
    } else {
      laserLogger.info(meta || {}, message);
    }
  }
}

function maskApiKey(url: string): string {
  return url.replace(/api-key=[^&]*/, 'api-key=***');
}

function generateRandomSignature(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let signature = '';
  for (let i = 0; i < 88; i++) {
    signature += chars[Math.floor(Math.random() * chars.length)];
  }
  return signature;
}

// ─── Simulation Stream ───
export function startSimulationStream(
  eventBusCallback: (event: SseEvent) => void,
  network: LaserStreamNetwork = 'devnet'
): void {
  stopSimulationStream();

  const sessionId = ++state.currentSessionId;
  state.isSimulated = true;
  state.isUsingFallback = false;
  state.network = network;
  state.mode = 'simulation';
  state.status = 'simulated';
  state.activeEndpoint = `local-sandbox-${network}`;
  state.transportConnected = true;
  state.lastEventTime = Date.now();
  state.errorMessage = null;

  laserLogger.info({ network }, 'Initializing LaserStream local simulation feed');

  let currentSlot = network === 'devnet' ? 320_000_000 : 274_152_000;
  currentSlot += Math.floor(Math.random() * 10_000);

  state.simulationTimer = setInterval(() => {
    if (state.currentSessionId !== sessionId) return;

    currentSlot += Math.floor(Math.random() * 3) + 1;
    const signature = generateRandomSignature();

    const dedupeKey = `${network}:${currentSlot}:${signature}`;
    if (!signatureDeduplicator.add(dedupeKey)) return;

    state.lastSlot = currentSlot;
    state.lastEventTime = Date.now();
    state.eventsReceived++;

    const event: SseEvent = {
      type: 'ON_CHAIN_TX',
      slot: currentSlot,
      signature,
      rawPayload: {
        slot: currentSlot,
        signature,
        transaction: { transaction: { signatures: [signature] } },
      },
      isFallback: false,
      isSimulated: true,
      endpoint: state.activeEndpoint,
      network: state.network,
    };

    eventBusCallback(event);
  }, SIMULATION_INTERVAL);
}

function stopSimulationStream(): void {
  if (state.simulationTimer) {
    clearInterval(state.simulationTimer);
    state.simulationTimer = null;
  }
  state.isSimulated = false;
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

async function getFastestRegionalHub(
  network: LaserStreamNetwork = 'mainnet',
  excludeHubs: Set<string> = new Set()
): Promise<string | null> {
  const candidateHubs = (LASERSTREAM_ENDPOINTS[network] || LASERSTREAM_ENDPOINTS.mainnet)
    .filter((h) => !excludeHubs.has(h));
  
  if (candidateHubs.length === 0) return null;

  laserLogger.info({ network, candidates: candidateHubs.length }, 'Probing regional LaserStream hubs for fastest response');

  const results = await Promise.all(
    candidateHubs.map(async (url) => {
      const latency = await probeHubLatency(url);
      laserLogger.debug({ hub: url, latency }, 'Hub TLS probe result');
      return { url, latency };
    })
  );

  const validResults = results.filter((r) => Number.isFinite(r.latency));
  if (validResults.length === 0) {
    laserLogger.warn('All hub TLS probes failed, selecting default hub for network');
    return candidateHubs[0];
  }

  validResults.sort((a, b) => a.latency - b.latency);
  const fastest = validResults[0];

  laserLogger.info({ hub: fastest.url, latency: fastest.latency, network }, 'Selected optimal regional hub');
  return fastest.url;
}

// ─── Health Watchdog ───
function startHealthWatchdog(): void {
  if (state.healthCheckTimer) clearInterval(state.healthCheckTimer);

  state.healthCheckTimer = setInterval(() => {
    state.lastHeartbeatTime = Date.now();

    // Differentiate transport health from event stream silence
    if (state.transportConnected) {
      const timeSinceLastEvent = state.lastEventTime ? Date.now() - state.lastEventTime : Infinity;
      if (timeSinceLastEvent > 60_000) {
        state.status = 'stalled';
      } else {
        state.status = state.isSimulated ? 'simulated' : state.isUsingFallback ? 'fallback' : 'connected';
      }
    } else {
      state.status = 'error';
    }
  }, HEALTH_CHECK_INTERVAL);
}

function stopHealthWatchdog(): void {
  if (state.healthCheckTimer) {
    clearInterval(state.healthCheckTimer);
    state.healthCheckTimer = null;
  }
}

// ─── Worker Process Management ───
function stopWorkerProcess(): void {
  if (!state.childProcess) return;

  laserLogger.info('Terminating LaserStream worker process');
  try {
    state.childProcess.disconnect();
  } catch {
    // Ignore
  }

  try {
    state.childProcess.kill('SIGTERM');
  } catch {
    // Ignore
  }

  state.childProcess = null;
}

// ─── Worker Entry Point ───
export async function runLaserstreamWorker(): Promise<void> {
  laserLogger.info('LaserStream worker process started');

  const options = JSON.parse(process.env.LASERSTREAM_OPTIONS || '{}');
  const apiKey = options.apiKey;
  const endpoint = options.endpoint;
  const programs = options.programAddresses || [];
  const network = options.network || 'devnet';

  const laserConfig: LaserstreamConfig = {
    apiKey,
    endpoint,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
  };

  const subscriptionRequest: SubscribeRequest = {
    commitment: CommitmentLevel.CONFIRMED,
    transactions: {
      'network-transactions': {
        accountInclude: programs.length > 0 ? programs : DEFAULT_NETWORK_PROGRAMS[network as LaserStreamNetwork],
        vote: false,
        failed: false,
      },
    },
    accounts: {
      'tracked-token-accounts': {
        account: [],
        owner: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
      },
    },
  };

  try {
    const sub = await subscribe(
      laserConfig,
      subscriptionRequest,
      (updatePayload) => {
        if (updatePayload.transaction) {
          const txData = updatePayload.transaction;
          const signature = txData.transaction?.signatures?.[0];
          const slot = updatePayload.slot;

          const standardEvent = {
            type: 'ON_CHAIN_TX',
            slot,
            signature:
              signature && typeof signature === 'string'
                ? signature
                : Buffer.from(signature as any).toString('hex'),
            rawPayload: { slot, signature, transaction: txData },
            isFallback: false,
            isSimulated: false,
            network,
          };

          if (process.send) {
            process.send({ type: 'EVENT', event: standardEvent });
          }
        }
      },
      (error: unknown) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (process.send) {
          process.send({ type: 'ERROR', error: errorMsg, errDetails: errorMsg });
        }
      }
    );

    if (process.send) {
      process.send({ type: 'READY' });
    }

    process.on('disconnect', () => {
      laserLogger.info('Parent disconnected, cleanly stopping worker subscription');
      try {
        const s = sub as any;
        if (typeof s.cancel === 'function') {
          s.cancel();
        } else if (typeof s.unsubscribe === 'function') {
          s.unsubscribe();
        }
      } catch {
        // Ignore
      }
      process.exit(0);
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (process.send) {
      process.send({ type: 'ERROR', error: errorMsg, errDetails: errorMsg });
    }
    process.exit(1);
  }
}

// ─── Main Stream Start ───
export async function startLaserStream(
  options: LaserStreamOptions,
  eventBusCallback: (event: SseEvent) => void,
  failedHubs: Set<string> = new Set()
): Promise<{ cancel(): void; unsubscribe(): void } | null> {
  const sessionId = ++state.currentSessionId;
  const network = options.network || 'devnet';
  const apiKey = options.apiKey || config.HELIUS_API_KEY || '';
  const programs = (options.programAddresses && options.programAddresses.length > 0)
    ? options.programAddresses
    : DEFAULT_NETWORK_PROGRAMS[network];

  state.network = network;
  state.status = 'connecting';
  state.errorMessage = null;

  // Stop previous stream components cleanly
  stopFallbackWebSocket();
  stopWorkerProcess();
  stopSimulationStream();

  // If free key or developer mode without valid key, route to network-matched WebSocket or simulation
  if (isFreeOrDefaultKey(apiKey)) {
    laserLogger.info({ network }, 'Free/default API key detected: using network-matched High-Speed WebSocket stream');
    state.isUsingFallback = true;
    state.mode = 'websocket';
    await startFallbackWebSocket(programs, eventBusCallback, apiKey, network, options.customWsUrl, sessionId);
    startHealthWatchdog();
    return null;
  }

  // Auto-select endpoint or respect user custom endpoint
  let endpoint = options.endpoint || 'auto';
  if (endpoint === 'auto' || !endpoint.includes('http')) {
    const fastestHub = await getFastestRegionalHub(network, failedHubs);
    if (fastestHub) {
      endpoint = fastestHub;
    } else {
      laserLogger.warn({ network }, 'No reachable gRPC hubs found, falling back to network-matched WebSocket');
      state.isUsingFallback = true;
      state.mode = 'websocket';
      await startFallbackWebSocket(programs, eventBusCallback, apiKey, network, options.customWsUrl, sessionId);
      startHealthWatchdog();
      return null;
    }
  }

  // Set active state for gRPC stream
  state.isUsingFallback = false;
  state.isSimulated = false;
  state.mode = 'grpc';
  state.activeEndpoint = endpoint;
  state.transportConnected = false;
  state.lastEventTime = Date.now();

  laserLogger.info({ endpoint, network, programFilters: programs.length }, 'Starting Helius LaserStream gRPC');

  // Handle fallback with session guard
  const handleFallback = (errorMsg?: string) => {
    if (state.currentSessionId !== sessionId) return;
    if (state.isUsingFallback) return;

    stopWorkerProcess();
    state.errorMessage = errorMsg || null;

    if (!isPlanError(errorMsg) && endpoint && (!options.endpoint || options.endpoint === 'auto')) {
      failedHubs.add(endpoint);
      const totalHubs = (LASERSTREAM_ENDPOINTS[network] || LASERSTREAM_ENDPOINTS.mainnet).length;
      if (failedHubs.size < totalHubs) {
        laserLogger.info({ failedHub: endpoint, remaining: totalHubs - failedHubs.size }, 'Regional hub failed, attempting failover');
        startLaserStream(options, eventBusCallback, failedHubs);
        return;
      }
    }

    state.isUsingFallback = true;
    state.mode = 'websocket';
    laserLogger.info({ network, error: errorMsg }, 'Switching to network-matched High-Speed WebSocket stream');
    startFallbackWebSocket(programs, eventBusCallback, apiKey, network, options.customWsUrl, sessionId);
  };

  // Spawn worker process with session tracking
  try {
    const workerOptions = { apiKey, endpoint, programAddresses: programs, network };
    let scriptPath = process.argv[1];
    if (!scriptPath || scriptPath.trim() === '' || !fs.existsSync(scriptPath)) {
      if (fs.existsSync(path.resolve(process.cwd(), 'dist/server.cjs'))) {
        scriptPath = path.resolve(process.cwd(), 'dist/server.cjs');
      } else {
        scriptPath = path.resolve(process.cwd(), 'server.ts');
      }
    }

    const execArgv = scriptPath.endsWith('.ts') ? ['--import', 'tsx'] : [];

    state.childProcess = fork(scriptPath, [], {
      execArgv,
      env: {
        ...process.env,
        IS_LASERSTREAM_WORKER: 'true',
        LASERSTREAM_OPTIONS: JSON.stringify(workerOptions),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    state.childProcess.stderr?.on('data', (data: Buffer) => {
      const str = data.toString();
      rateLimitedLog('warn', `gRPC worker stderr: ${str.trim()}`);
    });

    state.childProcess.stdout?.on('data', (data: Buffer) => {
      const str = data.toString();
      rateLimitedLog('info', `gRPC worker stdout: ${str.trim()}`);
    });

    state.childProcess.on('message', (msg: { type: string; event?: SseEvent; error?: string; errDetails?: string }) => {
      if (state.currentSessionId !== sessionId) return;

      if (msg.type === 'EVENT' && msg.event) {
        const signature = msg.event.signature;
        const slot = msg.event.slot;

        if (signature) {
          const dedupeKey = `${network}:${slot || 0}:${signature}`;
          if (!signatureDeduplicator.add(dedupeKey)) return;
        }

        state.transportConnected = true;
        state.status = 'connected';
        state.lastEventTime = Date.now();
        state.lastSlot = slot || state.lastSlot;
        state.eventsReceived++;
        msg.event.endpoint = state.activeEndpoint;
        msg.event.network = network;

        eventBusCallback(msg.event);
      } else if (msg.type === 'ERROR') {
        const errStr = msg.error || msg.errDetails || 'gRPC worker stream error';
        state.errorMessage = errStr;
        laserLogger.warn({ error: errStr, endpoint }, 'gRPC worker reported stream error');
        handleFallback(errStr);
      } else if (msg.type === 'READY') {
        state.transportConnected = true;
        state.status = 'connected';
        state.errorMessage = null;
        laserLogger.info({ endpoint, network }, 'LaserStream gRPC connection established');
      }
    });

    state.childProcess.on('exit', (code: number | null, signal: string | null) => {
      if (state.currentSessionId !== sessionId) return;
      state.transportConnected = false;
      laserLogger.info({ code, signal }, 'LaserStream worker process exited');
      if (!state.isUsingFallback && !state.isSimulated) {
        handleFallback('Worker process exited unexpectedly');
      }
    });

    startHealthWatchdog();

    state.activeSubscription = {
      cancel: () => stopWorkerProcess(),
      unsubscribe: () => stopWorkerProcess(),
    };

    return state.activeSubscription;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    laserLogger.error({ error: msg }, 'Failed to spawn LaserStream worker process');
    handleFallback(msg);
    startHealthWatchdog();
    return null;
  }
}

// ─── Network-Aware Fallback WebSocket ───
export async function startFallbackWebSocket(
  programs: string[],
  eventBusCallback: (event: SseEvent) => void,
  apiKey: string,
  network: LaserStreamNetwork = 'devnet',
  customWsUrl?: string,
  sessionId = state.currentSessionId
): Promise<void> {
  if (state.currentSessionId !== sessionId) return;

  stopFallbackWebSocket();
  state.isSimulated = false;
  state.isUsingFallback = true;
  state.network = network;
  state.mode = 'websocket';
  state.status = 'connecting';

  try {
    const wsUrl = getHeliusWsUrl(network, apiKey, customWsUrl);
    laserLogger.info({ endpoint: maskApiKey(wsUrl), network }, 'Connecting network-matched WebSocket stream');
    state.activeEndpoint = wsUrl;

    const ws = new WebSocket(wsUrl);
    state.fallbackRawWs = ws;

    ws.on('open', () => {
      if (state.currentSessionId !== sessionId) {
        try { ws.close(); } catch {}
        return;
      }

      state.transportConnected = true;
      state.status = 'fallback';
      state.lastEventTime = Date.now();
      state.fallbackBackoffMs = 3_000;
      state.errorMessage = null;

      laserLogger.info({ network }, 'WebSocket stream connected to Helius endpoint');

      // Ping keepalive every 15 seconds
      if (state.fallbackPingInterval) clearInterval(state.fallbackPingInterval);
      state.fallbackPingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
          } catch {
            // Ignore
          }
        }
      }, 15_000);

      // Subscribe to logs for configured program addresses
      programs.forEach((prog, index) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: index + 1,
              method: 'logsSubscribe',
              params: [{ mentions: [prog] }, { commitment: 'confirmed' }],
            })
          );
        }
      });
    });

    ws.on('message', (data: WebSocket.Data) => {
      if (state.currentSessionId !== sessionId) return;

      state.lastEventTime = Date.now();
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.method === 'logsNotification' && parsed.params?.result?.value) {
          const val = parsed.params.result.value;
          const ctx = parsed.params.result.context || {};
          const signature = val.signature;
          const slot = ctx.slot || 0;

          if (signature) {
            const dedupeKey = `${network}:${slot}:${signature}`;
            if (!signatureDeduplicator.add(dedupeKey)) return;

            state.lastSlot = slot;
            state.eventsReceived++;

            const event: SseEvent = {
              type: 'ON_CHAIN_TX',
              slot,
              signature,
              rawPayload: {
                slot,
                signature,
                transaction: { transaction: { signatures: [signature] } },
              },
              isFallback: true,
              isSimulated: false,
              endpoint: state.activeEndpoint,
              network,
            };

            eventBusCallback(event);
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on('error', (wsErr) => {
      if (state.currentSessionId !== sessionId) return;
      const errMsg = wsErr?.message || String(wsErr);
      state.errorMessage = errMsg;

      if (errMsg.includes('429') || errMsg.includes('Too Many Requests')) {
        laserLogger.warn({ error: errMsg, network }, 'WebSocket rate limited (429), backing off reconnect');
        state.fallbackBackoffMs = Math.max(state.fallbackBackoffMs, 15_000);
      } else {
        rateLimitedLog('warn', `WebSocket connection notice: ${errMsg}`);
      }
    });

    ws.on('close', () => {
      if (state.currentSessionId !== sessionId) return;

      state.transportConnected = false;
      if (state.fallbackPingInterval) {
        clearInterval(state.fallbackPingInterval);
        state.fallbackPingInterval = null;
      }

      if (state.isUsingFallback && !state.isSimulated) {
        state.reconnectCount++;
        const backoff = state.fallbackBackoffMs;
        state.fallbackBackoffMs = Math.min(60_000, backoff * 1.5);
        laserLogger.info({ network, backoffSec: Math.round(backoff / 1000) }, 'WebSocket closed, scheduling reconnect');

        if (state.fallbackReconnectTimer) clearTimeout(state.fallbackReconnectTimer);
        state.fallbackReconnectTimer = setTimeout(() => {
          if (state.currentSessionId === sessionId) {
            startFallbackWebSocket(programs, eventBusCallback, apiKey, network, customWsUrl, sessionId);
          }
        }, backoff);
      }
    });
  } catch (err: unknown) {
    if (state.currentSessionId !== sessionId) return;

    state.transportConnected = false;
    const msg = err instanceof Error ? err.message : String(err);
    state.errorMessage = msg;
    laserLogger.error({ error: msg, network }, 'WebSocket connection initialization failed');

    const backoff = state.fallbackBackoffMs;
    state.fallbackBackoffMs = Math.min(60_000, backoff * 1.5);

    if (state.fallbackReconnectTimer) clearTimeout(state.fallbackReconnectTimer);
    state.fallbackReconnectTimer = setTimeout(() => {
      if (state.currentSessionId === sessionId) {
        startFallbackWebSocket(programs, eventBusCallback, apiKey, network, customWsUrl, sessionId);
      }
    }, backoff);
  }
}

export function stopFallbackWebSocket(): void {
  if (state.fallbackReconnectTimer) {
    clearTimeout(state.fallbackReconnectTimer);
    state.fallbackReconnectTimer = null;
  }

  if (state.fallbackPingInterval) {
    clearInterval(state.fallbackPingInterval);
    state.fallbackPingInterval = null;
  }

  if (state.fallbackRawWs) {
    try {
      const ws = state.fallbackRawWs;
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.close();
    } catch {
      // Ignore
    }
    state.fallbackRawWs = null;
  }
}

// ─── Stop Everything ───
export async function stopLaserStream(): Promise<void> {
  state.currentSessionId++;
  stopFallbackWebSocket();
  stopWorkerProcess();
  stopHealthWatchdog();
  stopSimulationStream();

  state.transportConnected = false;
  state.isUsingFallback = false;
  state.isSimulated = false;
  state.status = 'disabled';
  state.activeEndpoint = null;
  state.activeSubscription = null;
  state.errorMessage = null;

  try {
    shutdownAllStreams();
  } catch {
    // Ignore native module shutdown notice
  }

  laserLogger.info('LaserStream engine fully stopped');
}
