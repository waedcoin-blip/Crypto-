// server/market/YellowstoneConnectionManager.ts
import ClientPkg from '@triton-one/yellowstone-grpc';
import { EventNormalizer } from './EventNormalizer.js';
import { marketEventBus } from './MarketEventBus.js';
import { tokenDiscovery } from './TokenDiscovery.js';

const Client = (ClientPkg as any).default || ClientPkg;
const CommitmentLevel = (ClientPkg as any).CommitmentLevel || { CONFIRMED: 1 };

export interface YellowstoneConfig {
  endpoint?: string;
  xToken?: string;
  network?: string;
}

export interface StreamTelemetry {
  network: string;
  connected: boolean;
  activeEndpoint: string | null;
  lastReceivedSlot: number;
  lastEventAt: number;
  reconnectCount: number;
}

export class YellowstoneConnectionManager {
  private static instances: Map<string, YellowstoneConnectionManager> = new Map();

  private network: string;
  private endpoint: string;
  private xToken?: string;
  private client: any = null;
  private stream: any = null;
  private isConnected = false;
  private isConnecting = false;
  private lastReceivedSlot = 0;
  private lastEventAt = 0;
  private reconnectCount = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private constructor(network: string) {
    this.network = network;

    if (network === 'devnet') {
      this.endpoint = process.env.YELLOWSTONE_GRPC_DEVNET_ENDPOINT || 'https://grpc.devnet.helius-rpc.com:443';
      this.xToken = process.env.YELLOWSTONE_GRPC_DEVNET_X_TOKEN;
    } else {
      this.endpoint = process.env.YELLOWSTONE_GRPC_ENDPOINT || 'https://grpc.mainnet.helius-rpc.com:443';
      this.xToken = process.env.YELLOWSTONE_GRPC_X_TOKEN;
    }
  }

  public static getInstance(network: string = 'mainnet'): YellowstoneConnectionManager {
    const net = network.toLowerCase();
    if (!YellowstoneConnectionManager.instances.has(net)) {
      YellowstoneConnectionManager.instances.set(net, new YellowstoneConnectionManager(net));
    }
    return YellowstoneConnectionManager.instances.get(net)!;
  }

  public async connect(): Promise<boolean> {
    if (this.isConnected || this.isConnecting) return true;

    const xToken =
      this.xToken ||
      process.env.HELIUS_API_KEY ||
      (this.network === 'devnet'
        ? process.env.YELLOWSTONE_GRPC_DEVNET_X_TOKEN
        : process.env.YELLOWSTONE_GRPC_X_TOKEN);

    if (this.endpoint.includes('helius-rpc.com') && !xToken) {
      console.log(`[YELLOWSTONE MANAGER] Yellowstone gRPC X-Token / HELIUS_API_KEY not configured for ${this.network}. Skipping gRPC connection.`);
      this.isConnected = false;
      this.isConnecting = false;
      return false;
    }

    this.isConnecting = true;

    try {
      console.log(`[YELLOWSTONE MANAGER] Connecting to ${this.network} gRPC endpoint: ${this.endpoint}`);
      this.client = new Client(this.endpoint, xToken || undefined, undefined);

      this.stream = await this.client.subscribe();
      this.isConnected = true;
      this.isConnecting = false;
      this.lastEventAt = Date.now();

      const request: any = {
        slots: {
          slot_sub: { filterByCommitment: true },
        },
        transactions: {
          tx_sub: {
            vote: false,
            failed: false,
            signature: undefined,
            accountInclude: [],
            accountExclude: [],
            accountRequired: [],
          },
        },
        accounts: {},
        transactionsStatus: {},
        entry: {},
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        commitment: CommitmentLevel.CONFIRMED,
        ping: undefined,
      };

      await this.writeSubscribeRequest(request);

      this.stream.on('data', (update: any) => {
        this.handleData(update);
      });

      this.stream.on('error', (err: any) => {
        console.warn(`[YELLOWSTONE MANAGER] Stream error on ${this.network}:`, err?.message || err);
        this.handleDisconnect();
      });

      this.stream.on('end', () => {
        console.warn(`[YELLOWSTONE MANAGER] Stream ended on ${this.network}`);
        this.handleDisconnect();
      });

      console.log(`[YELLOWSTONE MANAGER] Connected successfully on ${this.network}`);
      return true;
    } catch (err: any) {
      this.isConnecting = false;
      this.isConnected = false;
      const errMsg = String(err?.message || err);
      console.log(`[YELLOWSTONE MANAGER] Could not establish gRPC connection on ${this.network}: ${errMsg}`);
      const lower = errMsg.toLowerCase();
      if (
        lower.includes('failed to connect') ||
        lower.includes('failed to open subscribe stream') ||
        lower.includes('401') ||
        lower.includes('permission denied') ||
        lower.includes('unavailable')
      ) {
        console.log(`[YELLOWSTONE MANAGER] gRPC endpoint unavailable or unauthenticated on ${this.network}. Auto-reconnect paused.`);
        return false;
      }
      this.scheduleReconnect();
      return false;
    }
  }

  private writeSubscribeRequest(request: any): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream) return reject(new Error('No stream available'));
      this.stream.write(request, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private handleData(update: any): void {
    this.lastEventAt = Date.now();
    const event = EventNormalizer.normalizeYellowstoneUpdate(update, this.network);
    if (!event) return;

    if (event.slot > this.lastReceivedSlot) {
      this.lastReceivedSlot = event.slot;
    }

    // Publish to MarketEventBus
    marketEventBus.publish(event);
  }

  private handleDisconnect(): void {
    this.isConnected = false;
    this.stream = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    if (this.reconnectCount >= 10) {
      console.log(`[YELLOWSTONE MANAGER] Max reconnect attempts (10) reached for ${this.network}. Pausing auto-reconnect.`);
      return;
    }

    this.reconnectCount++;
    const backoffMs = Math.min(30000, 1000 * Math.pow(2, Math.min(this.reconnectCount, 5)));
    console.log(`[YELLOWSTONE MANAGER] Scheduling reconnect #${this.reconnectCount} in ${backoffMs}ms for ${this.network}...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, backoffMs);
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stream) {
      try { this.stream.end(); } catch {}
      this.stream = null;
    }
    this.isConnected = false;
  }

  public getTelemetry(): StreamTelemetry {
    return {
      network: this.network,
      connected: this.isConnected,
      activeEndpoint: this.endpoint,
      lastReceivedSlot: this.lastReceivedSlot,
      lastEventAt: this.lastEventAt,
      reconnectCount: this.reconnectCount,
    };
  }
}

export const yellowstoneConnectionManager = YellowstoneConnectionManager.getInstance('mainnet');
