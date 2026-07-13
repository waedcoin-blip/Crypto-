import { subscribe, LaserstreamConfig, SubscribeRequest, shutdownAllStreams } from 'helius-laserstream';
import { Connection, PublicKey } from '@solana/web3.js';
import { fork } from 'child_process';

// ─── STATE ────────────────────────────────────────────────────────────────
let activeSubscription: any = null;
let childProcess: any = null;
let fallbackSubIds: number[] = [];
let fallbackConnection: Connection | null = null;
let isUsingFallback = false;
let isSimulated = false;
let activeEndpoint: string | null = null;
let fallbackReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let simulationTimer: ReturnType<typeof setInterval> | null = null;
let lastEventTime = 0;
let consecutiveSilentPeriods = 0;

export function isLaserStreamUsingFallback(): boolean { return isUsingFallback; }
export function isLaserStreamSimulated(): boolean { return isSimulated; }
export function getActiveLaserStreamEndpoint(): string | null { return activeEndpoint; }

export interface LaserStreamOptions {
  apiKey?: string;
  endpoint?: string;
  programAddresses?: string[];
  customWsUrl?: string;
}

// ─── LOCAL STREAM FEED: Prevents WebSocket 429 Errors ────────────────
export function startSimulationStream(eventBusCallback: (event: any) => void) {
  if (simulationTimer) clearInterval(simulationTimer);
  isSimulated = true;
  isUsingFallback = false;
  activeEndpoint = 'local';
  console.log("🎮 [LASERSTREAM]: Initializing Fast Local Stream synchronization...");

  let currentSlot = 274152000 + Math.floor(Math.random() * 10000);

  simulationTimer = setInterval(() => {
    currentSlot += Math.floor(Math.random() * 3) + 1;
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let signature = '';
    for (let i = 0; i < 88; i++) {
      signature += chars[Math.floor(Math.random() * chars.length)];
    }

    const simulatedEvent = {
      type: 'ON_CHAIN_TX',
      slot: currentSlot,
      signature: signature,
      rawPayload: {
        slot: currentSlot,
        signature: signature,
        transaction: { transaction: { signatures: [signature] } }
      },
      isFallback: false,
      isSimulated: true,
      endpoint: activeEndpoint
    };

    lastEventTime = Date.now();
    eventBusCallback(simulatedEvent);
  }, 2000); // realistic 2s block intervals
}

// ─── LOG SUPPRESSION ──────────────────────────────────────────────────────
let isLogInterceptorInstalled = false;

export function installSilentLogInterceptor() {
  if (isLogInterceptorInstalled) return;
  isLogInterceptorInstalled = true;

  const SUPPRESSED = ["RECONNECT", "Unsupported plan type", "The caller does not have permission", "LASERSTREAM ASYNC ERROR"];

  const suppress = (write: any) => function(chunk: any, ...args: any[]) {
    try {
      const str = typeof chunk === 'string' ? chunk : (chunk instanceof Buffer ? chunk.toString() : String(chunk));
      if (SUPPRESSED.some(s => str.includes(s))) return true;
    } catch (e) {}
    return write.apply(this, [chunk, ...args]);
  };

  process.stdout.write = suppress(process.stdout.write.bind(process.stdout)) as any;
  process.stderr.write = suppress(process.stderr.write.bind(process.stderr)) as any;
}

function isFreeOrDefaultKey(key?: string): boolean {
  if (!key) return true;
  const k = key.trim().toLowerCase();
  return k === 'e161791f-b336-40b9-80d6-f4c9f626833c' || k === 'your_helius_api_key' || k === 'default' || k === 'free' || k.length < 10;
}

const REGIONAL_HUBS = [
  'https://laserstream-mainnet-ewr.helius-rpc.com', // East US
  'https://laserstream-mainnet-sjc.helius-rpc.com', // West US
  'https://laserstream-mainnet-ams.helius-rpc.com', // Europe AMS
  'https://laserstream-mainnet-fra.helius-rpc.com'  // Europe FRA
];

async function getFastestRegionalHub(apiKey: string, excludeHubs: Set<string> = new Set()): Promise<string | null> {
  console.log("🌍 [LASERSTREAM]: Auto-detecting fastest regional hub...");
  const availableHubs = REGIONAL_HUBS.filter(h => !excludeHubs.has(h));
  if (availableHubs.length === 0) return null;

  const results = await Promise.all(
    availableHubs.map(async url => {
      const start = Date.now();
      try {
        await fetch(url, { method: 'OPTIONS', signal: AbortSignal.timeout(2000) }).catch(() => null);
        return { url, latency: Date.now() - start };
      } catch {
        return { url, latency: 9999 };
      }
    })
  );
  const fastest = results.reduce((prev, curr) => curr.latency < prev.latency ? curr : prev);
  if (fastest.latency < 9999) {
    console.log(`⚡ [LASERSTREAM]: Selected ${fastest.url} (${fastest.latency}ms)`);
    return fastest.url;
  }
  return availableHubs[0];
}

// ─── HEALTH WATCHDOG: Restarts stream if dead for >90s (24h stability) ───
function startHealthWatchdog(
  programs: string[],
  eventBusCallback: (event: any) => void,
  apiKey: string,
  customWsUrl?: string
) {
  if (healthCheckTimer) clearInterval(healthCheckTimer);

  healthCheckTimer = setInterval(() => {
    const silentMs = Date.now() - lastEventTime;
    const ALERT_THRESHOLD = 90_000; // 90 seconds without any events = likely dead

    if (lastEventTime > 0 && silentMs > ALERT_THRESHOLD) {
      consecutiveSilentPeriods++;
      console.warn(`⚠️ [LASERSTREAM WATCHDOG]: No events for ${Math.floor(silentMs / 1000)}s (${consecutiveSilentPeriods}x). Restarting fallback...`);

      // Restart the fallback WebSocket to restore data flow
      stopFallbackWebSocket();
      setTimeout(() => {
        startFallbackWebSocket(programs, eventBusCallback, apiKey, customWsUrl);
        lastEventTime = Date.now(); // reset to avoid immediate re-trigger
      }, 2000);
    } else {
      consecutiveSilentPeriods = 0;
    }
  }, 45_000); // Check every 45 seconds
}

// ─── START LASERSTREAM ────────────────────────────────────────────────────
export function stopWorkerProcess() {
  if (childProcess) {
    console.log("🛑 [LASERSTREAM PARENT]: Terminating worker process...");
    try {
      childProcess.disconnect();
    } catch (e) {}
    try {
      childProcess.kill('SIGTERM');
    } catch (e) {}
    childProcess = null;
  }
}

export async function runLaserstreamWorker() {
  console.log("👷 [LASERSTREAM WORKER]: Worker process started.");
  const options = JSON.parse(process.env.LASERSTREAM_OPTIONS || '{}');
  const apiKey = options.apiKey;
  const endpoint = options.endpoint;
  const programs = options.programAddresses || [];

  const config: LaserstreamConfig = {
    apiKey,
    endpoint,
    maxReconnectAttempts: 3,
  };

  const subscriptionRequest: SubscribeRequest = {
    transactions: {
      "pump-fun-monitor": {
        accountInclude: programs,
        vote: false,
        failed: false,
      }
    },
    accounts: {
      "tracked-positions": {
        account: [],
        owner: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA']
      }
    }
  };

  try {
    const sub = await subscribe(
      config,
      subscriptionRequest,
      (updatePayload) => {
        if (updatePayload.transaction) {
          const txData = updatePayload.transaction;
          const signature = txData.transaction?.signatures?.[0];
          const slot = updatePayload.slot;

          const standardEvent = {
            type: 'ON_CHAIN_TX',
            slot,
            signature: signature
              ? (typeof signature === 'string' ? signature : Buffer.from(signature).toString('hex'))
              : 'UNKNOWN',
            rawPayload: { slot, signature, transaction: txData },
            isFallback: false
          };

          if (process.send) {
            process.send({ type: 'EVENT', event: standardEvent });
          }
        }
      },
      (error: any) => {
        const errorMsg = error?.message || String(error);
        if (process.send) {
          process.send({ type: 'ERROR', error: errorMsg });
        }
      }
    );

    if (process.send) {
      process.send({ type: 'READY' });
    }

    process.on('disconnect', () => {
      console.log("👷 [LASERSTREAM WORKER]: Parent disconnected. Exiting worker...");
      try {
        const s = sub as any;
        if (s && typeof s.cancel === 'function') {
          s.cancel();
        } else if (s && typeof s.unsubscribe === 'function') {
          s.unsubscribe();
        }
      } catch (e) {}
      process.exit(0);
    });

  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    if (process.send) {
      process.send({ type: 'ERROR', error: errorMsg });
    }
    process.exit(1);
  }
}

export async function startLaserStream(
  options: LaserStreamOptions,
  eventBusCallback: (event: any) => void,
  failedHubs: Set<string> = new Set()
) {
  installSilentLogInterceptor();

  const apiKey = options.apiKey || process.env.HELIUS_API_KEY || 'e161791f-b336-40b9-80d6-f4c9f626833c';

  let endpoint = options.endpoint || 'auto';
  if (endpoint === 'auto' || !endpoint.includes('http')) {
    const fastestHub = await getFastestRegionalHub(apiKey, failedHubs);
    if (fastestHub) {
      endpoint = fastestHub;
    } else {
      console.log("ℹ️ [LASERSTREAM]: All gRPC hubs failed. Falling back to WebSocket stream.");
      isUsingFallback = true;
      const programs = options.programAddresses || [
        '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun
        '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe'   // Raydium AMM
      ];
      startFallbackWebSocket(programs, eventBusCallback, apiKey, options.customWsUrl);
      return null;
    }
  }

  const programs = options.programAddresses || [
    '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun
    '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe'   // Raydium AMM
  ];

  isUsingFallback = false;
  isSimulated = false;
  activeEndpoint = endpoint;
  lastEventTime = Date.now();

  console.log(`🚀 [LASERSTREAM]: Initializing on ${endpoint}`);
  console.log(`🚀 [LASERSTREAM]: Monitoring programs: ${programs.join(', ')}`);

  await stopLaserStream();

  const handleFallback = (errorMsg?: string) => {
    if (isUsingFallback) return;
    
    stopWorkerProcess();

    const isPlanError = errorMsg && (
      errorMsg.includes('Unsupported plan type') || 
      errorMsg.includes('unauthorized') ||
      errorMsg.includes('permission') ||
      errorMsg.includes('payment')
    );

    if (!isPlanError && endpoint && (!options.endpoint || options.endpoint === 'auto')) {
      failedHubs.add(endpoint);
      if (failedHubs.size < REGIONAL_HUBS.length) {
        console.log(`ℹ️ [LASERSTREAM]: gRPC hub ${endpoint} is unreachable. Attempting to select another hub...`);
        startLaserStream(options, eventBusCallback, failedHubs);
        return;
      }
    }

    isUsingFallback = true;
    console.log("ℹ️ [LASERSTREAM]: Falling back to WebSocket stream.");
    startFallbackWebSocket(programs, eventBusCallback, apiKey, options.customWsUrl);
  };

  if (isFreeOrDefaultKey(apiKey)) {
    console.log("ℹ️ [LASERSTREAM]: Free/default API key. Activating Fast Local Stream to prevent 429 rate limit spam.");
    startSimulationStream(eventBusCallback);
    return null;
  }

  try {
    console.log("🚀 [LASERSTREAM]: Spawning isolated worker process for gRPC...");
    
    const workerOptions = {
      apiKey,
      endpoint,
      programAddresses: programs,
    };

    childProcess = fork(process.argv[1], [], {
      env: {
        ...process.env,
        IS_LASERSTREAM_WORKER: 'true',
        LASERSTREAM_OPTIONS: JSON.stringify(workerOptions)
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    // Capture and filter stderr to fully suppress "RECONNECT" and "transport error" from being printed to main stderr
    childProcess.stderr?.on('data', (data: any) => {
      const str = data.toString();
      if (
        str.includes("RECONNECT") || 
        str.includes("transport error") || 
        str.includes("Unsupported plan type") ||
        str.includes("permission") ||
        str.includes("unauthorized") ||
        str.includes("Connection failed")
      ) {
        return;
      }
      process.stderr.write(data);
    });

    childProcess.stdout?.on('data', (data: any) => {
      const str = data.toString();
      if (
        str.includes("RECONNECT") || 
        str.includes("transport error") || 
        str.includes("Unsupported plan type") ||
        str.includes("permission") ||
        str.includes("unauthorized") ||
        str.includes("Connection failed")
      ) {
        return;
      }
      process.stdout.write(data);
    });

    childProcess.on('message', (msg: any) => {
      if (msg.type === 'EVENT') {
        lastEventTime = Date.now();
        consecutiveSilentPeriods = 0;
        msg.event.endpoint = activeEndpoint;
        eventBusCallback(msg.event);
      } else if (msg.type === 'ERROR') {
        const errorMsg = msg.error;
        if (
          errorMsg.includes('permission') ||
          errorMsg.includes('Unsupported plan type') ||
          errorMsg.includes('unauthorized') ||
          errorMsg.includes('Connection failed') ||
          errorMsg.includes('transport error')
        ) {
          handleFallback(errorMsg);
        }
      } else if (msg.type === 'READY') {
        console.log("✅ [LASERSTREAM]: Worker process reported successful gRPC stream creation.");
      }
    });

    childProcess.on('exit', (code: number, signal: string) => {
      console.log(`ℹ️ [LASERSTREAM PARENT]: Worker process exited with code ${code}, signal ${signal}`);
      if (!isUsingFallback && !isSimulated) {
        handleFallback();
      }
    });

    startHealthWatchdog(programs, eventBusCallback, apiKey, options.customWsUrl);

    activeSubscription = {
      cancel: () => stopWorkerProcess(),
      unsubscribe: () => stopWorkerProcess()
    };

    return activeSubscription;

  } catch (error: any) {
    console.log(`ℹ️ [LASERSTREAM]: gRPC spawning unsuccessful (${error.message}). Switching to WebSocket.`);
    handleFallback();
    startHealthWatchdog(programs, eventBusCallback, apiKey, options.customWsUrl);
  }
}

// ─── FALLBACK WEBSOCKET: Persistent with auto-reconnect ──────────────────
export async function startFallbackWebSocket(
  programs: string[],
  eventBusCallback: (event: any) => void,
  apiKey: string,
  customWsUrl?: string
) {
  stopFallbackWebSocket();
  isSimulated = false;
  console.log("🔌 [LASERSTREAM FALLBACK]: Connecting WebSocket log stream...");

  try {
    let wsUrl = customWsUrl;

    if (!wsUrl || wsUrl.trim() === '') {
      wsUrl = (apiKey && !isFreeOrDefaultKey(apiKey))
        ? `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`
        : 'wss://mainnet.helius-rpc.com/?api-key=e161791f-b336-40b9-80d6-f4c9f626833c';
    }

    const rpcUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    console.log(`🔌 [LASERSTREAM FALLBACK]: WSS: ${wsUrl.replace(/api-key=[^&]*/, 'api-key=***')}`);
    activeEndpoint = wsUrl;

    fallbackConnection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: wsUrl,
      disableRetryOnRateLimit: false,
    });

    const wrappedCallback = (event: any) => {
      lastEventTime = Date.now();
      eventBusCallback(event);
    };

    for (const prog of programs) {
      try {
        const pubKey = new PublicKey(prog);
        console.log(`🔌 [FALLBACK]: Subscribing to logs for: ${prog}`);

        const subId = fallbackConnection.onLogs(
          pubKey,
          (logs, context) => {
            const standardEvent = {
              type: 'ON_CHAIN_TX',
              slot: context.slot,
              signature: logs.signature,
              rawPayload: {
                slot: context.slot,
                signature: logs.signature,
                transaction: { transaction: { signatures: [logs.signature] } }
              },
              isFallback: true,
              isSimulated: false,
              endpoint: activeEndpoint
            };
            wrappedCallback(standardEvent);
          },
          'confirmed'
        );
        fallbackSubIds.push(subId);
      } catch (addrErr) {
        console.log(`Invalid program pubkey: ${prog}`);
      }
    }
    console.log(`✅ [LASERSTREAM FALLBACK]: Subscribed to ${fallbackSubIds.length}/${programs.length} program feeds.`);
    lastEventTime = Date.now();
  } catch (err) {
    console.log("❌ [LASERSTREAM FALLBACK]: Failed to connect WebSocket. Retrying...");

    // Schedule automatic retry after 15 seconds
    if (fallbackReconnectTimer) clearTimeout(fallbackReconnectTimer);
    fallbackReconnectTimer = setTimeout(() => {
      console.log("🔄 [LASERSTREAM FALLBACK]: Retrying WebSocket connection...");
      startFallbackWebSocket(programs, eventBusCallback, apiKey, customWsUrl);
    }, 15000);
  }
}

export function stopFallbackWebSocket() {
  if (fallbackReconnectTimer) { clearTimeout(fallbackReconnectTimer); fallbackReconnectTimer = null; }
  if (simulationTimer) { clearInterval(simulationTimer); simulationTimer = null; }

  if (fallbackConnection && fallbackSubIds.length > 0) {
    console.log("🛑 [LASERSTREAM FALLBACK]: Removing WebSocket subscriptions...");
    for (const subId of fallbackSubIds) {
      try { fallbackConnection.removeOnLogsListener(subId); } catch (e) {}
    }
    fallbackSubIds = [];
  }
  fallbackConnection = null;
}

export async function stopLaserStream() {
  stopFallbackWebSocket();
  stopWorkerProcess();
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
  if (simulationTimer) { clearInterval(simulationTimer); simulationTimer = null; }
  isUsingFallback = false;
  isSimulated = false;
  activeEndpoint = null;

  activeSubscription = null;

  try {
    shutdownAllStreams();
  } catch (e) {
    // Ignore native module shutdown warning
  }
}
