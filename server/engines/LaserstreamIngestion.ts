/**
 * Helius LaserStream Engine - Refactored
 * 
 * Features:
 * - gRPC streaming via worker process isolation
 * - WebSocket fallback with auto-reconnect
 * - Local simulation mode for free keys
 * - Health watchdog (90s silence detection)
 * - Regional hub auto-selection
 * - Structured logging (no console monkey-patching)
 */
import { subscribe, type LaserstreamConfig, type SubscribeRequest, shutdownAllStreams } from 'helius-laserstream';
import { Connection, PublicKey } from '@solana/web3.js';
import { fork } from 'child_process';
import type { ChildProcess } from 'child_process';
import { logger, laserLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { isBenignError } from '../utils/errors.js';
import { sleep } from '../utils/fetch.js';
import type { LaserStreamOptions, SseEvent } from '../types/index.js';

// ─── Constants ───
const REGIONAL_HUBS = [
  'https://laserstream-mainnet-ewr.helius-rpc.com', // East US
  'https://laserstream-mainnet-sjc.helius-rpc.com', // West US
  'https://laserstream-mainnet-ams.helius-rpc.com', // Europe AMS
  'https://laserstream-mainnet-fra.helius-rpc.com', // Europe FRA
] as const;

const DEFAULT_PROGRAMS = [
  '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun
  '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe', // Raydium AMM
] as const;

const HEALTH_CHECK_INTERVAL = 45_000;  // 45s
const SILENCE_THRESHOLD = 90_000;      // 90s
const FALLBACK_RETRY_DELAY = 15_000;   // 15s
const SIMULATION_INTERVAL = 2_000;     // 2s
const HUB_PROBE_TIMEOUT = 2_000;       // 2s
const MAX_RECONNECT_ATTEMPTS = 3;

const SUPPRESSED_LOG_PATTERNS = [
  'RECONNECT',
  'transport error',
  'Unsupported plan type',
  'permission',
  'unauthorized',
  'Connection failed',
  'Unexpected server response',
  '429',
  'ws error',
  'WebSocket',
  'websocket',
  'SUPPRESSED EXCEPTION',
] as const;

// ─── State ───
interface StreamState {
  activeSubscription: { cancel(): void; unsubscribe(): void } | null;
  childProcess: ChildProcess | null;
  fallbackSubIds: number[];
  fallbackConnection: Connection | null;
  isUsingFallback: boolean;
  isSimulated: boolean;
  activeEndpoint: string | null;
  fallbackReconnectTimer: ReturnType<typeof setTimeout> | null;
  healthCheckTimer: ReturnType<typeof setInterval> | null;
  simulationTimer: ReturnType<typeof setInterval> | null;
  lastEventTime: number;
  consecutiveSilentPeriods: number;
}

const state: StreamState = {
  activeSubscription: null,
  childProcess: null,
  fallbackSubIds: [],
  fallbackConnection: null,
  isUsingFallback: false,
  isSimulated: false,
  activeEndpoint: null,
  fallbackReconnectTimer: null,
  healthCheckTimer: null,
  simulationTimer: null,
  lastEventTime: 0,
  consecutiveSilentPeriods: 0,
};

// ─── Getters ───
export function isLaserStreamUsingFallback(): boolean { return state.isUsingFallback; }
export function isLaserStreamSimulated(): boolean { return state.isSimulated; }
export function getActiveLaserStreamEndpoint(): string | null { return state.activeEndpoint; }

// ─── Helpers ───
function isFreeOrDefaultKey(key?: string): boolean {
  if (!key) return true;
  const k = key.trim().toLowerCase();
  return (
    k === 'e161791f-b336-40b9-80d6-f4c9f626833c' ||
    k === 'your_helius_api_key' ||
    k === 'default' ||
    k === 'free' ||
    k.length < 10
  );
}

function isPlanError(errorMsg: string): boolean {
  return (
    errorMsg.includes('Unsupported plan type') ||
    errorMsg.includes('unauthorized') ||
    errorMsg.includes('permission') ||
    errorMsg.includes('payment')
  );
}

function shouldSuppressLog(data: string): boolean {
  return SUPPRESSED_LOG_PATTERNS.some((pattern) => data.includes(pattern));
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
export function startSimulationStream(eventBusCallback: (event: SseEvent) => void): void {
  stopSimulationStream();

  state.isSimulated = true;
  state.isUsingFallback = false;
  state.activeEndpoint = 'local';
  state.lastEventTime = Date.now();

  laserLogger.info('Initializing simulation stream');

  let currentSlot = 274_152_000 + Math.floor(Math.random() * 10_000);

  state.simulationTimer = setInterval(() => {
    currentSlot += Math.floor(Math.random() * 3) + 1;
    const signature = generateRandomSignature();

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
    };

    state.lastEventTime = Date.now();
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
async function getFastestRegionalHub(
  apiKey: string,
  excludeHubs: Set<string> = new Set()
): Promise<string | null> {
  laserLogger.info('Auto-detecting fastest regional hub');

  const availableHubs = REGIONAL_HUBS.filter((h) => !excludeHubs.has(h));
  if (availableHubs.length === 0) return null;

  const results = await Promise.all(
    availableHubs.map(async (url) => {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), HUB_PROBE_TIMEOUT);
        await fetch(url, { method: 'OPTIONS', signal: controller.signal })
          .catch(() => null)
          .finally(() => clearTimeout(timeoutId));
        return { url, latency: Date.now() - start };
      } catch {
        return { url, latency: 9999 };
      }
    })
  );

  const fastest = results.reduce((prev, curr) =>
    curr.latency < prev.latency ? curr : prev
  );

  if (fastest.latency < 9999) {
    laserLogger.info({ hub: fastest.url, latency: fastest.latency }, 'Selected regional hub');
    return fastest.url;
  }

  return availableHubs[0];
}

// ─── Health Watchdog ───
function startHealthWatchdog(
  programs: string[],
  eventBusCallback: (event: SseEvent) => void,
  apiKey: string,
  customWsUrl?: string
): void {
  if (state.healthCheckTimer) clearInterval(state.healthCheckTimer);

  state.healthCheckTimer = setInterval(() => {
    const silentMs = Date.now() - state.lastEventTime;

    if (state.lastEventTime > 0 && silentMs > SILENCE_THRESHOLD) {
      state.consecutiveSilentPeriods++;
      laserLogger.warn(
        { silentSeconds: Math.floor(silentMs / 1000), count: state.consecutiveSilentPeriods },
        'Stream silence detected, restarting fallback'
      );

      stopFallbackWebSocket();
      setTimeout(() => {
        startFallbackWebSocket(programs, eventBusCallback, apiKey, customWsUrl);
        state.lastEventTime = Date.now();
      }, 2000);
    } else {
      state.consecutiveSilentPeriods = 0;
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

  laserLogger.info('Terminating worker process');

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
  laserLogger.info('Worker process started');

  const options = JSON.parse(process.env.LASERSTREAM_OPTIONS || '{}');
  const apiKey = options.apiKey;
  const endpoint = options.endpoint;
  const programs = options.programAddresses || [];

  const laserConfig: LaserstreamConfig = {
    apiKey,
    endpoint,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
  };

  const subscriptionRequest: SubscribeRequest = {
    transactions: {
      'pump-fun-monitor': {
        accountInclude: programs,
        vote: false,
        failed: false,
      },
    },
    accounts: {
      'tracked-positions': {
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
          };

          if (process.send) {
            process.send({ type: 'EVENT', event: standardEvent });
          }
        }
      },
      (error: unknown) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (process.send) {
          process.send({ type: 'ERROR', error: errorMsg });
        }
      }
    );

    if (process.send) {
      process.send({ type: 'READY' });
    }

    process.on('disconnect', () => {
      laserLogger.info('Parent disconnected, exiting worker');
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
      process.send({ type: 'ERROR', error: errorMsg });
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
  const apiKey = options.apiKey || config.HELIUS_API_KEY || '';
  const programs = options.programAddresses || [...DEFAULT_PROGRAMS];

  // Free key → simulation mode
  if (isFreeOrDefaultKey(apiKey)) {
    laserLogger.info('Free/default API key detected, using simulation stream');
    startSimulationStream(eventBusCallback);
    return null;
  }

  // Auto-select endpoint
  let endpoint = options.endpoint || 'auto';
  if (endpoint === 'auto' || !endpoint.includes('http')) {
    const fastestHub = await getFastestRegionalHub(apiKey, failedHubs);
    if (fastestHub) {
      endpoint = fastestHub;
    } else {
      laserLogger.info('All gRPC hubs failed, falling back to WebSocket');
      state.isUsingFallback = true;
      startFallbackWebSocket(programs, eventBusCallback, apiKey, options.customWsUrl);
      return null;
    }
  }

  // Reset state
  state.isUsingFallback = false;
  state.isSimulated = false;
  state.activeEndpoint = endpoint;
  state.lastEventTime = Date.now();

  laserLogger.info({ endpoint, programs: programs.length }, 'Initializing LaserStream');

  await stopLaserStream();

  // Handle fallback on error
  const handleFallback = (errorMsg?: string) => {
    if (state.isUsingFallback) return;

    stopWorkerProcess();

    if (!isPlanError(errorMsg || '') && endpoint && (!options.endpoint || options.endpoint === 'auto')) {
      failedHubs.add(endpoint);
      if (failedHubs.size < REGIONAL_HUBS.length) {
        laserLogger.info({ failedHub: endpoint }, 'Hub unreachable, trying next');
        startLaserStream(options, eventBusCallback, failedHubs);
        return;
      }
    }

    state.isUsingFallback = true;
    laserLogger.info('Falling back to WebSocket stream');
    startFallbackWebSocket(programs, eventBusCallback, apiKey, options.customWsUrl);
  };

  // Spawn worker process
  try {
    laserLogger.info('Spawning isolated worker process for gRPC');

    const workerOptions = { apiKey, endpoint, programAddresses: programs };

    state.childProcess = fork(process.argv[1], [], {
      env: {
        ...process.env,
        IS_LASERSTREAM_WORKER: 'true',
        LASERSTREAM_OPTIONS: JSON.stringify(workerOptions),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    // Filter stderr
    state.childProcess.stderr?.on('data', (data: Buffer) => {
      const str = data.toString();
      if (shouldSuppressLog(str)) return;
      process.stderr.write(data);
    });

    // Filter stdout
    state.childProcess.stdout?.on('data', (data: Buffer) => {
      const str = data.toString();
      if (shouldSuppressLog(str)) return;
      process.stdout.write(data);
    });

    // Handle messages
    state.childProcess.on('message', (msg: { type: string; event?: SseEvent; error?: string }) => {
      if (msg.type === 'EVENT' && msg.event) {
        state.lastEventTime = Date.now();
        state.consecutiveSilentPeriods = 0;
        msg.event.endpoint = state.activeEndpoint;
        eventBusCallback(msg.event);
      } else if (msg.type === 'ERROR' && msg.error) {
        if (
          msg.error.includes('permission') ||
          msg.error.includes('Unsupported plan type') ||
          msg.error.includes('unauthorized') ||
          msg.error.includes('Connection failed') ||
          msg.error.includes('transport error')
        ) {
          handleFallback(msg.error);
        }
      } else if (msg.type === 'READY') {
        laserLogger.info('Worker reported successful gRPC stream creation');
      }
    });

    state.childProcess.on('exit', (code: number | null, signal: string | null) => {
      laserLogger.info({ code, signal }, 'Worker process exited');
      if (!state.isUsingFallback && !state.isSimulated) {
        handleFallback();
      }
    });

    startHealthWatchdog(programs, eventBusCallback, apiKey, options.customWsUrl);

    state.activeSubscription = {
      cancel: () => stopWorkerProcess(),
      unsubscribe: () => stopWorkerProcess(),
    };

    return state.activeSubscription;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    laserLogger.error({ error: msg }, 'gRPC spawning failed, switching to WebSocket');
    handleFallback(msg);
    startHealthWatchdog(programs, eventBusCallback, apiKey, options.customWsUrl);
    return null;
  }
}

// ─── Fallback WebSocket ───
export async function startFallbackWebSocket(
  programs: string[],
  eventBusCallback: (event: SseEvent) => void,
  apiKey: string,
  customWsUrl?: string
): Promise<void> {
  stopFallbackWebSocket();
  state.isSimulated = false;

  laserLogger.info('Connecting WebSocket fallback stream');

  try {
    let wsUrl = customWsUrl;

    if (!wsUrl?.trim()) {
      const key = apiKey && !isFreeOrDefaultKey(apiKey) ? apiKey : config.HELIUS_API_KEY;
      wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${key}`;
    }

    const rpcUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    laserLogger.info({ url: maskApiKey(wsUrl) }, 'WebSocket endpoint');
    state.activeEndpoint = wsUrl;

    state.fallbackConnection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: wsUrl,
      disableRetryOnRateLimit: false,
    });

    const wrappedCallback = (event: SseEvent) => {
      state.lastEventTime = Date.now();
      eventBusCallback(event);
    };

    for (const prog of programs) {
      try {
        const pubKey = new PublicKey(prog);
        laserLogger.info({ program: prog }, 'Subscribing to logs');

        const subId = state.fallbackConnection.onLogs(
          pubKey,
          (logs, context) => {
            const event: SseEvent = {
              type: 'ON_CHAIN_TX',
              slot: context.slot,
              signature: logs.signature,
              rawPayload: {
                slot: context.slot,
                signature: logs.signature,
                transaction: { transaction: { signatures: [logs.signature] } },
              },
              isFallback: true,
              isSimulated: false,
              endpoint: state.activeEndpoint,
            };
            wrappedCallback(event);
          },
          'confirmed'
        );
        state.fallbackSubIds.push(subId);
      } catch (addrErr) {
        laserLogger.warn({ program: prog }, 'Invalid program pubkey');
      }
    }

    laserLogger.info(
      { subscribed: state.fallbackSubIds.length, total: programs.length },
      'WebSocket subscriptions active'
    );
    state.lastEventTime = Date.now();
  } catch (err: unknown) {
    laserLogger.error({ error: err instanceof Error ? err.message : String(err) }, 'WebSocket connection failed');

    // Schedule retry
    if (state.fallbackReconnectTimer) clearTimeout(state.fallbackReconnectTimer);
    state.fallbackReconnectTimer = setTimeout(() => {
      laserLogger.info('Retrying WebSocket connection');
      startFallbackWebSocket(programs, eventBusCallback, apiKey, customWsUrl);
    }, FALLBACK_RETRY_DELAY);
  }
}

export function stopFallbackWebSocket(): void {
  if (state.fallbackReconnectTimer) {
    clearTimeout(state.fallbackReconnectTimer);
    state.fallbackReconnectTimer = null;
  }

  stopSimulationStream();

  if (state.fallbackConnection && state.fallbackSubIds.length > 0) {
    laserLogger.info('Removing WebSocket subscriptions');
    for (const subId of state.fallbackSubIds) {
      try {
        state.fallbackConnection.removeOnLogsListener(subId);
      } catch {
        // Ignore
      }
    }
    state.fallbackSubIds = [];
  }

  state.fallbackConnection = null;
}

// ─── Stop Everything ───
export async function stopLaserStream(): Promise<void> {
  stopFallbackWebSocket();
  stopWorkerProcess();
  stopHealthWatchdog();
  stopSimulationStream();

  state.isUsingFallback = false;
  state.isSimulated = false;
  state.activeEndpoint = null;
  state.activeSubscription = null;

  try {
    shutdownAllStreams();
  } catch {
    // Ignore native module shutdown warning
  }

  laserLogger.info('LaserStream fully stopped');
}
