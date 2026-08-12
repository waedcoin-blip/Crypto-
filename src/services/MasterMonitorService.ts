// src/services/MasterMonitorService.ts
import { Connection } from '@solana/web3.js';
import { PositionExitManager } from './PositionExitManager';

export interface TokenPriceUpdate {
  mint: string;
  priceNative: number;
  priceUsd?: number;
  timestamp: number;
  source: 'rpc_ws' | 'jupiter' | 'dexscreener' | 'price_tracker';
  slot?: number;
}

export class MasterMonitorService {
  private connection: Connection;
  private exitManager: PositionExitManager;
  private subscribedMints = new Set<string>();
  private batchInterval: ReturnType<typeof setInterval> | null = null;
  private wsSubscriptionIds = new Map<string, number>();

  constructor(rpcEndpoint: string, exitManager: PositionExitManager) {
    this.connection = new Connection(rpcEndpoint || 'https://api.mainnet-beta.solana.com', 'confirmed');
    this.exitManager = exitManager;
  }

  public setRpcEndpoint(rpcEndpoint: string) {
    if (rpcEndpoint) {
      this.connection = new Connection(rpcEndpoint, 'confirmed');
    }
  }

  async startMonitoring(mints: string[]): Promise<void> {
    for (const mint of mints) {
      if (mint) this.subscribedMints.add(mint);
    }
    
    this.ensureBatchPolling();
    this.setupWsSubscriptions();
  }

  // Fast direct push update from RPC parser, WebSocket, or Market Tracker
  public pushPriceUpdate(mint: string, priceNative: number, timestamp = Date.now(), source: TokenPriceUpdate['source'] = 'jupiter'): void {
    if (!mint || priceNative <= 0) return;
    this.subscribedMints.add(mint);
    
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
                this.exitManager.onPriceUpdate(mint, priceNative, now);
              }
            }
          }
        }
      } catch (err) {
        // Silently handle batch polling fallback
      }
    };

    // Initial poll
    pollBatch();

    // Single unified ticker for ALL active tokens (250ms)
    this.batchInterval = setInterval(pollBatch, 250);
  }

  private setupWsSubscriptions(): void {
    // Attempt WebSocket onLogs / onAccountChange subscriptions via Master Monitor RPC connection
    for (const mint of this.subscribedMints) {
      if (this.wsSubscriptionIds.has(mint)) continue;

      try {
        // Subscribe to transaction logs touching active mint token accounts on-chain
        const subId = this.connection.onLogs(
          { mentions: [mint] } as any,
          (_logs, ctx) => {
            // High priority on-chain activity detected for mint — trigger instant quote / price recheck
            this.triggerInstantPriceCheck(mint, ctx?.slot);
          },
          'confirmed'
        );
        this.wsSubscriptionIds.set(mint, subId);
      } catch {
        // WS subscription fallback to batch polling
      }
    }
  }

  private async triggerInstantPriceCheck(mint: string, slot?: number): Promise<void> {
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
      // Fallback handled by batch ticker
    }
  }

  stopMonitoring(mint?: string): void {
    if (mint) {
      this.subscribedMints.delete(mint);
      const subId = this.wsSubscriptionIds.get(mint);
      if (subId !== undefined) {
        try { this.connection.removeOnLogsListener(subId); } catch {}
        this.wsSubscriptionIds.delete(mint);
      }
    } else {
      for (const subId of this.wsSubscriptionIds.values()) {
        try { this.connection.removeOnLogsListener(subId); } catch {}
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

