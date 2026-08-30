// src/services/MasterMonitorService.ts
import { Connection } from '@solana/web3.js';
import { PositionExitManager } from './PositionExitManager';
import { masterMonitorHealthManager } from './MasterMonitorHealthManager';
import { getNetworkConfig } from '../config/network';

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
    const defaultRpc = getNetworkConfig('paper').rpcUrl;
    const ep = rpcEndpoint && rpcEndpoint.trim() ? rpcEndpoint.trim() : defaultRpc;
    const wsEndpoint = masterMonitorHealthManager.getActiveWsEndpoint() || undefined;
    this.connection = new Connection(ep, {
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
    
    const now = Date.now();
    // Do not accept or forward stale price updates (older than 5s)
    if (timestamp < now - 5000) {
      return;
    }

    // Source authority rule: if existing price source is Jupiter and fresh (< 30s), reject non-Jupiter sources
    const existing = this.priceEngine.get(mint);
    if (existing && existing.source === 'jupiter' && source !== 'jupiter' && (now - existing.updatedAt) < 30000) {
      return;
    }

    this.subscribedMints.add(mint);
    
    this.priceEngine.set(mint, {
      priceNative,
      source,
      isStale: false,
      updatedAt: timestamp,
    });

    // 🔥 INSTANT DIRECT PATH: Fresh valid market price -> Exit Manager (TP/SL evaluator -> Jupiter pre-sell validation -> exit)
    this.exitManager.onPriceUpdate(mint, priceNative, timestamp, 'SOL', source);
  }

  private ensureBatchPolling(): void {
    if (this.batchInterval) return;

    const pollBatch = async () => {
      const mints = Array.from(this.subscribedMints).filter(Boolean);
      if (mints.length === 0) return;

      try {
        const response = await fetch(`https://api.jup.ag/price/v2?ids=${encodeURIComponent(mints.join(','))}`).catch(() => null);
        if (!response || !response.ok) return;
        const data = await response.json();
        const now = Date.now();
        for (const mint of mints) {
          const priceNative = Number(data.data?.[mint]?.price);
          if (Number.isFinite(priceNative) && priceNative > 0) {
            this.pushPriceUpdate(mint, priceNative, now, 'jupiter');
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
            });
          }
        }
      }
    };

    // Initial poll
    pollBatch();

    // Single fast unified ticker for ALL active tokens (250ms high-frequency Jupiter polling)
    this.batchInterval = setInterval(pollBatch, 250);
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

  private async triggerInstantPriceCheck(mint: string, _slot?: number): Promise<void> {
    const now = Date.now();
    const lastTime = this.lastCheckTime.get(mint) || 0;
    if (now - lastTime < 250) return;
    this.lastCheckTime.set(mint, now);
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${encodeURIComponent(mint)}`).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        const priceNative = Number(data.data?.[mint]?.price);
        if (Number.isFinite(priceNative) && priceNative > 0) {
          this.pushPriceUpdate(mint, priceNative, Date.now(), 'jupiter');
        }
      }
    } catch {}
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

