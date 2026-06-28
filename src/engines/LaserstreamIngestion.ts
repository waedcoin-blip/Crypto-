import { subscribe, LaserstreamConfig, SubscribeRequest, shutdownAllStreams } from 'helius-laserstream';
import { Connection, PublicKey } from '@solana/web3.js';

// ─── STATE ────────────────────────────────────────────────────────────────
let activeSubscription: any = null;
let fallbackSubIds: number[] = [];
let fallbackConnection: Connection | null = null;
let isUsingFallback = false;
let isSimulated = false;
let fallbackReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let lastEventTime = 0;
let consecutiveSilentPeriods = 0;

export function isLaserStreamUsingFallback(): boolean { return isUsingFallback; }
export function isLaserStreamSimulated(): boolean { return isSimulated; }

export interface LaserStreamOptions {
  apiKey?: string;
  endpoint?: string;
  programAddresses?: string[];
  customWsUrl?: string;
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

async function getFastestRegionalHub(apiKey: string): Promise<string> {
  console.log("🌍 [LASERSTREAM]: Auto-detecting fastest regional hub...");
  const results = await Promise.all(
    REGIONAL_HUBS.map(async url => {
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
  return REGIONAL_HUBS[0];
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
export async function startLaserStream(
  options: LaserStreamOptions,
  eventBusCallback: (event: any) => void
) {
  installSilentLogInterceptor();

  const apiKey = options.apiKey || process.env.HELIUS_API_KEY || 'e161791f-b336-40b9-80d6-f4c9f626833c';

  let endpoint = options.endpoint || 'auto';
  if (endpoint === 'auto' || !endpoint.includes('http')) {
    endpoint = await getFastestRegionalHub(apiKey);
  }

  const programs = options.programAddresses || [
    '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun
    '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe'   // Raydium AMM
  ];

  isUsingFallback = false;
  isSimulated = false;
  lastEventTime = Date.now();

  console.log(`🚀 [LASERSTREAM]: Initializing on ${endpoint}`);
  console.log(`🚀 [LASERSTREAM]: Monitoring programs: ${programs.join(', ')}`);

  await stopLaserStream();

  const handleFallback = () => {
    if (isUsingFallback) return;
    isUsingFallback = true;
    console.log("ℹ️ [LASERSTREAM]: Falling back to WebSocket stream.");
    startFallbackWebSocket(programs, eventBusCallback, apiKey, options.customWsUrl);
  };

  if (isFreeOrDefaultKey(apiKey)) {
    console.log("ℹ️ [LASERSTREAM]: Free/default API key. Using WebSocket fallback directly.");
    handleFallback();
    startHealthWatchdog(programs, eventBusCallback, apiKey, options.customWsUrl);
    return null;
  }

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

  // Wrap event callback to update the health watchdog timestamp
  const wrappedCallback = (event: any) => {
    lastEventTime = Date.now();
    consecutiveSilentPeriods = 0;
    eventBusCallback(event);
  };

  try {
    activeSubscription = await subscribe(
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

          wrappedCallback(standardEvent);
        }
      },
      (error: any) => {
        const errorMsg = error?.message || String(error);
        if (
          errorMsg.includes('permission') ||
          errorMsg.includes('Unsupported plan type') ||
          errorMsg.includes('unauthorized') ||
          errorMsg.includes('Connection failed')
        ) {
          handleFallback();
        } else {
          console.log(`[LASERSTREAM INFO]: ${errorMsg}`);
        }
      }
    );

    console.log("✅ [LASERSTREAM]: gRPC pipeline established successfully.");
    lastEventTime = Date.now();

    // Start health watchdog regardless of which path we took
    startHealthWatchdog(programs, eventBusCallback, apiKey, options.customWsUrl);

    return activeSubscription;
  } catch (error: any) {
    const catchMsg = error?.message || String(error);
    console.log(`ℹ️ [LASERSTREAM]: gRPC setup failed (${catchMsg}). Switching to WebSocket.`);
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
  console.log("🔌 [LASERSTREAM FALLBACK]: Connecting WebSocket log stream...");

  try {
    let wsUrl = customWsUrl;

    if (!wsUrl || wsUrl.trim() === '') {
      wsUrl = (apiKey && !isFreeOrDefaultKey(apiKey))
        ? `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`
        : 'wss://api.mainnet-beta.solana.com';
    }

    const rpcUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    console.log(`🔌 [LASERSTREAM FALLBACK]: WSS: ${wsUrl.replace(/api-key=[^&]*/, 'api-key=***')}`);

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
              isSimulated: false
            };
            wrappedCallback(standardEvent);
          },
          'confirmed'
        );
        fallbackSubIds.push(subId);
      } catch (addrErr) {
        console.error(`Invalid program pubkey: ${prog}`, addrErr);
      }
    }
    console.log(`✅ [LASERSTREAM FALLBACK]: Subscribed to ${fallbackSubIds.length}/${programs.length} program feeds.`);
    lastEventTime = Date.now();
  } catch (err) {
    console.error("❌ [LASERSTREAM FALLBACK]: Failed to connect WebSocket:", err);

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
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
  isUsingFallback = false;
  isSimulated = false;

  if (activeSubscription) {
    console.log("🛑 [LASERSTREAM]: Shutting down gRPC tunnel.");
    try {
      if (typeof activeSubscription.unsubscribe === 'function') {
        await activeSubscription.unsubscribe();
      }
    } catch (e) {
      console.error("[LASERSTREAM]: Error on unsubscribe:", e);
    }
    activeSubscription = null;
  }

  try {
    shutdownAllStreams();
  } catch (e) {
    // Ignore native module shutdown warning
  }
}
