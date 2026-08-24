// src/services/MasterMonitorService.ts
import { Connection } from '@solana/web3.js';
import { PositionExitManager } from './PositionExitManager';
import { masterMonitorHealthManager } from './MasterMonitorHealthManager';

export interface TokenPriceUpdate {
  mint: string;
  priceNative: number;
  priceUsd?: number;
  timestamp: number;
  source: 'rpc_ws' | 'jupiter' | 'dexscreener' | 'price_tracker';
  slot?: number;
}

export interface PriceState {
  priceNative: number;
  source: 'rpc_ws' | 'jupiter' | 'dexscreener' | 'price_tracker';
  isStale: boolean;
  updatedAt: number;
}

export class MasterMonitorService {
  private connection: Connection;
  private exitManager: PositionExitManager;
  private subscribedMints = new Set<string>();
  private batchInterval: ReturnType<typeof setInterval> | null = null;
  private wsSubscriptionIds = new Map<string, number>();
  private lastCheckTime = new Map<string, number>();
  private priceEngine = new Map<string, PriceState>();
  private connectionGeneration = 0;

  constructor(rpcEndpoint: string, exitManager: PositionExitManager) {
    if (!rpcEndpoint || !rpcEndpoint.trim()) {
      throw new Error('[MasterMonitorService] Dedicated Master Monitor RPC endpoint is required. Fallback to public beta RPC is disallowed.');
    }
    const wsEndpoint = masterMonitorHealthManager.getActiveWsEndpoint() || undefined;
    this.connection = new Connection(rpcEndpoint.trim(), {
      commitment: 'confirmed',
      wsEndpoint,
    });
    this.exitManager = exitManager;
  }

  public getPriceState(mint: string): PriceState | undefined {
    const state = this.priceEngine.get(mint);
    if (!state) return undefined;
    // Mark as stale if updatedAt is older than 15 seconds
    const isStale = (Date.now() - state.updatedAt) > 15000;
    return {
      ...state,
      isStale,
    };
  }

  public setRpcEndpoint(rpcEndpoint: string) {
    if (rpcEndpoint && rpcEndpoint.trim()) {
      this.connectionGeneration++;
      
      // Unsubscribe existing WS logs
      for (const subId of this.wsSubscriptionIds.values()) {
        try { this.connection.removeOnLogsListener(subId).catch(() => {}); } catch {}
      }
      this.wsSubscriptionIds.clear();

      const wsEndpoint = masterMonitorHealthManager.getActiveWsEndpoint() || undefined;
      this.connection = new Connection(rpcEndpoint.trim(), {
        commitment: 'confirmed',
        wsEndpoint,
      });

      // Restart subscriptions on the new connection
      this.setupWsSubscriptions();
    }
  }

  async startMonitoring(mints: string[]): Promise<void> {
    for (const rawMint of mints) {
      if (!rawMint) continue;
      const mint = rawMint.includes(':') ? rawMint.split(':')[1] : rawMint;
      this.subscribedMints.add(mint);
    }
    
    this.ensureBatchPolling();
    this.setupWsSubscriptions();
  }

  // Fast direct push update from RPC parser, WebSocket, or Market Tracker
  public pushPriceUpdate(rawMint: string, priceNative: number, timestamp = Date.now(), source: TokenPriceUpdate['source'] = 'jupiter'): void {
    if (!rawMint || priceNative <= 0) return;
    const mint = rawMint.includes(':') ? rawMint.split(':')[1] : rawMint;
    this.subscribedMints.add(mint);
    
    this.priceEngine.set(mint, {
      priceNative,
      source,
      isStale: false,
      updatedAt: timestamp,
    });

    // 🔥 INSTANT DIRECT PATH: Price update -> Exit Manager (<1ms evaluation)
    this.exitManager.onPriceUpdate(mint, priceNative, timestamp);
  }

  private ensureBatchPolling(): void {
    if (this.batchInterval) return;

    const pollBatch = async () => {
      const mints = Array.from(this.subscribedMints).filter(Boolean);
      if (mints.length === 0) return;

      try {
        // Single BATCH HTTP call for ALL subscribed tokens instead of N requests
        const idsParam = mints.join(',');
        const response = await fetch(`https://api.jup.ag/price/v2?ids=${idsParam}`);
        
        if (response.ok) {
          const data = await response.json();
          const priceMap = data.data || {};
          const now = Date.now();

          for (const mint of mints) {
            const priceInfo = priceMap[mint];
            if (priceInfo?.price) {
              const priceNative = parseFloat(priceInfo.price);
              if (priceNative > 0) {
                this.pushPriceUpdate(mint, priceNative, now, 'jupiter');
                continue;
              }
            }

            // Fallback for Devnet or unlisted tokens: fetch from DexScreener or retain active price
            try {
              const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
              if (dexRes.ok) {
                const dexData = await dexRes.json();
                const pair = dexData.pairs?.[0];
                if (pair?.priceNative) {
                  const priceNative = parseFloat(pair.priceNative);
                  if (priceNative > 0) {
                    this.pushPriceUpdate(mint, priceNative, now, 'dexscreener');
                    continue;
                  }
                }
              }
            } catch {
              // Ignore DexScreener error
            }

            // Keep existing price updated if still fresh or active
            const existing = this.priceEngine.get(mint);
            if (existing && existing.priceNative > 0) {
              this.pushPriceUpdate(mint, existing.priceNative, now, existing.source);
            }
          }
        }
      } catch (err) {
        // Handle failure by marking existing prices as stale rather than purging them
        for (const mint of mints) {
          const existing = this.priceEngine.get(mint);
          if (existing) {
            this.priceEngine.set(mint, {
              ...existing,
              isStale: true,
              // Bug 6 Fix: DO NOT refresh updatedAt to Date.now() when marking stale
            });
          }
        }
      }
    };

    // Initial poll
    pollBatch();

    // Single relaxed unified ticker for ALL active tokens (4000ms)
    this.batchInterval = setInterval(pollBatch, 4000);
  }

  private setupWsSubscriptions(): void {
    const currentGeneration = this.connectionGeneration;
    // Dedicated WebSocket onLogs subscriptions via Master Monitor RPC connection
    for (const mint of this.subscribedMints) {
      if (this.wsSubscriptionIds.has(mint)) continue;

      try {
        // Subscribe to real-time transaction logs touching active mint accounts on-chain
        const subId = this.connection.onLogs(
          { mentions: [mint] } as any,
          (_logs, ctx) => {
            if (this.connectionGeneration !== currentGeneration) return;
            // High priority on-chain activity detected for mint — trigger instant quote evaluation
            this.triggerInstantPriceCheck(mint, ctx?.slot);
          },
          'confirmed'
        );
        this.wsSubscriptionIds.set(mint, subId);
      } catch (e) {
        // Log error and rely on scheduled price aggregation
        console.warn(`[MasterMonitorService] Could not establish onLogs subscription for ${mint.slice(0, 6)}:`, e);
      }
    }
  }

  private async triggerInstantPriceCheck(mint: string, slot?: number): Promise<void> {
    const now = Date.now();
    const lastTime = this.lastCheckTime.get(mint) || 0;
    if (now - lastTime < 1500) {
      // Throttle instant checks to max once every 1.5 seconds per mint to prevent rate limits
      return;
    }
    this.lastCheckTime.set(mint, now);

    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
      if (res.ok) {
        const data = await res.json();
        const priceStr = data.data?.[mint]?.price;
        if (priceStr) {
          const priceNative = parseFloat(priceStr);
          if (priceNative > 0) {
            this.pushPriceUpdate(mint, priceNative, Date.now(), 'rpc_ws');
          }
        }
      }
    } catch {
      // Handled by scheduled batch price ticker
    }
  }


  stopMonitoring(mint?: string): void {
    if (mint) {
      this.subscribedMints.delete(mint);
      const subId = this.wsSubscriptionIds.get(mint);
      if (subId !== undefined) {
        try { this.connection.removeOnLogsListener(subId).catch(() => {}); } catch {}
        this.wsSubscriptionIds.delete(mint);
      }
    } else {
      for (const subId of this.wsSubscriptionIds.values()) {
        try { this.connection.removeOnLogsListener(subId).catch(() => {}); } catch {}
      }
      this.wsSubscriptionIds.clear();
      this.subscribedMints.clear();

      if (this.batchInterval) {
        clearInterval(this.batchInterval);
        this.batchInterval = null;
      }
    }
  }
}

