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
import { subscribe, CommitmentLevel, type LaserstreamConfig, type SubscribeRequest, shutdownAllStreams } from 'helius-laserstream';
import { Connection, PublicKey } from '@solana/web3.js';
import { fork } from 'child_process';
import type { ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import tls from 'tls';
import { URL } from 'url';
import WebSocket from 'ws';
import { logger, laserLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { isBenignError } from '../utils/errors.js';
import { sleep } from '../utils/fetch.js';
import type { LaserStreamOptions, SseEvent } from '../types/index.js';

// ─── Constants ───
const REGIONAL_HUBS = [
  'https://laserstream-mainnet-ams.helius-rpc.com', // Europe AMS (Amsterdam)
  'https://laserstream-mainnet-fra.helius-rpc.com', // Europe FRA (Frankfurt)
  'https://laserstream-mainnet-lon.helius-rpc.com', // Europe LON (London)
  'https://laserstream-mainnet-ewr.helius-rpc.com', // East US EWR (Newark)
  'https://laserstream-mainnet-tyo.helius-rpc.com', // Asia TYO (Tokyo)
  'https://laserstream-mainnet-sgp.helius-rpc.com', // Asia SGP (Singapore)
] as const;

const DEFAULT_PROGRAMS = [
  '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun
  '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe', // Raydium AMM
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
] as const;

const HEALTH_CHECK_INTERVAL = 15_000;  // 15s
const SILENCE_THRESHOLD = 30_000;      // 30s
const FALLBACK_RETRY_DELAY = 5_000;    // 5s
const SIMULATION_INTERVAL = 2_000;     // 2s
const HUB_PROBE_TIMEOUT = 2_500;       // 2.5s
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
  'Invalid API key',
  'valid authentication credentials',
] as const;

// ─── State ───
interface StreamState {
  activeSubscription: { cancel(): void; unsubscribe(): void } | null;
  childProcess: ChildProcess | null;
  fallbackSubIds: number[];
  fallbackConnection: Connection | null;
  fallbackRawWs: WebSocket | null;
  fallbackPingInterval: ReturnType<typeof setInterval> | null;
  isUsingFallback: boolean;
  isSimulated: boolean;
  activeEndpoint: string | null;
  fallbackReconnectTimer: ReturnType<typeof setTimeout> | null;
  healthCheckTimer: ReturnType<typeof setInterval> | null;
  simulationTimer: ReturnType<typeof setInterval> | null;
  lastEventTime: number;
  consecutiveSilentPeriods: number;
  fallbackBackoffMs: number;
}

const state: StreamState = {
  activeSubscription: null,
  childProcess: null,
  fallbackSubIds: [],
  fallbackConnection: null,
  fallbackRawWs: null,
  fallbackPingInterval: null,
  isUsingFallback: false,
  isSimulated: false,
  activeEndpoint: null,
  fallbackReconnectTimer: null,
  healthCheckTimer: null,
  simulationTimer: null,
  lastEventTime: 0,
  consecutiveSilentPeriods: 0,
  fallbackBackoffMs: 3_000,
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
    k === '98ec7a83-f29a-4ead-aaa3-3f288daf43b7' ||
    k === 'b422aec3-82c7-425c-a409-a48e744829ad' ||
    k === 'your_helius_api_key' ||
    k === 'default' ||
    k === 'free' ||
    k.length < 10
  );
}

function isPlanError(errorMsg?: string): boolean {
  if (!errorMsg || !errorMsg.trim()) return true;
  const lower = errorMsg.toLowerCase();
  return (
    lower.includes('unsupported plan') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('authentication credentials') ||
    lower.includes('credentials') ||
    lower.includes('permission') ||
    lower.includes('payment') ||
    lower.includes('unauthenticated') ||
    lower.includes('connection failed') ||
    lower.includes('transport error') ||
    lower.includes('grpc') ||
    lower.includes('failed to connect') ||
    lower.includes('403') ||
    lower.includes('401') ||
    lower.includes('400')
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
  apiKey: string,
  excludeHubs: Set<string> = new Set()
): Promise<string | null> {
  laserLogger.info('Auto-detecting fastest regional hub via TLS latency probe');

  const availableHubs = REGIONAL_HUBS.filter((h) => !excludeHubs.has(h));
  if (availableHubs.length === 0) return null;

  const results = await Promise.all(
    availableHubs.map(async (url) => {
      const latency = await probeHubLatency(url);
      laserLogger.debug({ hub: url, latency }, 'Hub TLS probe result');
      return { url, latency };
    })
  );

  const validResults = results.filter((r) => Number.isFinite(r.latency));
  if (validResults.length === 0) {
    laserLogger.warn('All hub TLS probes failed, defaulting to first available hub');
    return availableHubs[0];
  }

  validResults.sort((a, b) => a.latency - b.latency);
  const fastest = validResults[0];

  laserLogger.info({ hub: fastest.url, latency: fastest.latency }, 'Selected fastest regional hub');
  return fastest.url;
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

      // The gRPC worker process may still be alive but silently stalled - it
      // must be killed here, or it keeps running as an orphan alongside the
      // new WebSocket fallback, causing duplicate ON_CHAIN_TX events (and
      // therefore duplicate buy signals) for every subsequent transaction.
      stopWorkerProcess();
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
    commitment: CommitmentLevel.CONFIRMED,
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
          process.send({ type: 'ERROR', error: errorMsg, errDetails: errorMsg });
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
  const apiKey = options.apiKey || config.HELIUS_API_KEY || '';
  const programs = options.programAddresses || [...DEFAULT_PROGRAMS];

  // Stop previous stream first before setting active state
  await stopLaserStream();

  // If key is known default/free, attempt High-Speed WebSocket fallback directly or simulation stream
  if (isFreeOrDefaultKey(apiKey)) {
    laserLogger.info('Free/default API key detected, utilizing High-Speed WebSocket stream protocol');
    state.isUsingFallback = true;
    try {
      await startFallbackWebSocket(programs, eventBusCallback, apiKey, options.customWsUrl);
      return null;
    } catch (e: any) {
      laserLogger.warn({ errDetails: e?.message }, 'WebSocket fallback start failed, will retry on reconnection timer');
      return null;
    }
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

  // Set active state for gRPC stream
  state.isUsingFallback = false;
  state.isSimulated = false;
  state.activeEndpoint = endpoint;
  state.lastEventTime = Date.now();

  laserLogger.info({ endpoint, programs: programs.length }, 'Initializing LaserStream');

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
    state.childProcess.on('message', (msg: { type: string; event?: SseEvent; error?: string; errDetails?: string }) => {
      if (msg.type === 'EVENT' && msg.event) {
        state.lastEventTime = Date.now();
        state.consecutiveSilentPeriods = 0;
        msg.event.endpoint = state.activeEndpoint;
        eventBusCallback(msg.event);
      } else if (msg.type === 'ERROR') {
        const errStr = msg.error || msg.errDetails || 'gRPC worker stream error';
        if (isPlanError(errStr)) {
          laserLogger.info({ errDetails: errStr }, 'gRPC stream credentials invalid or plan unsupported, triggering fallback');
        } else {
          laserLogger.warn({ errDetails: errStr }, 'gRPC worker process reported stream error, triggering fallback');
        }
        handleFallback(errStr);
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
    laserLogger.error({ errDetails: msg }, 'gRPC spawning failed, switching to WebSocket');
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
  state.isUsingFallback = true;

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

    const wrappedCallback = (event: SseEvent) => {
      state.lastEventTime = Date.now();
      eventBusCallback(event);
    };

    // Direct WebSocket connection with instant auto-reconnect and ping keepalive
    try {
      const ws = new WebSocket(wsUrl);
      state.fallbackRawWs = ws;

      ws.on('open', () => {
        laserLogger.info('Raw WebSocket connected to Helius endpoint');
        state.lastEventTime = Date.now();
        state.fallbackBackoffMs = 3_000; // Reset backoff on successful connection
        stopSimulationStream(); // Stop simulation stream if active

        // Send ping keepalive every 15 seconds to keep connection active
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

        // Subscribe to logs for each program
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
        state.lastEventTime = Date.now();
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.method === 'logsNotification' && parsed.params?.result?.value) {
            const val = parsed.params.result.value;
            const ctx = parsed.params.result.context || {};
            const signature = val.signature;
            const slot = ctx.slot || 0;

            if (signature) {
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
              };
              wrappedCallback(event);
            }
          }
        } catch {
          // Ignore parse errors
        }
      });

      ws.on('error', (wsErr) => {
        const errMsg = wsErr?.message || String(wsErr);
        if (errMsg.includes('429') || errMsg.includes('Too Many Requests') || errMsg.includes('Unexpected server response')) {
          laserLogger.warn({ errDetails: errMsg }, 'Helius endpoint rate limited (429), backing off reconnect...');
          state.fallbackBackoffMs = Math.max(state.fallbackBackoffMs, 15_000);
        } else {
          laserLogger.warn({ errDetails: errMsg }, 'Raw WebSocket encountered error');
        }
      });

      ws.on('close', () => {
        if (state.fallbackPingInterval) {
          clearInterval(state.fallbackPingInterval);
          state.fallbackPingInterval = null;
        }
        if (state.isUsingFallback && !state.isSimulated) {
          const backoff = state.fallbackBackoffMs;
          state.fallbackBackoffMs = Math.min(60_000, backoff * 2);
          laserLogger.info(`Raw WebSocket closed, backing off reconnect for ${Math.round(backoff / 1000)}s`);

          if (state.fallbackReconnectTimer) clearTimeout(state.fallbackReconnectTimer);
          state.fallbackReconnectTimer = setTimeout(() => {
            startFallbackWebSocket(programs, eventBusCallback, apiKey, customWsUrl);
          }, backoff);
        }
      });
    } catch (rawWsErr) {
      laserLogger.warn({ errDetails: rawWsErr instanceof Error ? rawWsErr.message : String(rawWsErr) }, 'Failed creating raw WebSocket');
    }

    state.lastEventTime = Date.now();
  } catch (err: unknown) {
    laserLogger.error({ errDetails: err instanceof Error ? err.message : String(err) }, 'WebSocket connection failed');

    const backoff = state.fallbackBackoffMs;
    state.fallbackBackoffMs = Math.min(60_000, backoff * 2);

    if (state.fallbackReconnectTimer) clearTimeout(state.fallbackReconnectTimer);
    state.fallbackReconnectTimer = setTimeout(() => {
      laserLogger.info(`Retrying WebSocket connection after ${Math.round(backoff / 1000)}s backoff`);
      startFallbackWebSocket(programs, eventBusCallback, apiKey, customWsUrl);
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
      state.fallbackRawWs.removeAllListeners();
      state.fallbackRawWs.close();
    } catch {
      // Ignore
    }
    state.fallbackRawWs = null;
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
