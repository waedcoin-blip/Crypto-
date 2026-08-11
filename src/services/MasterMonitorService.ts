// src/services/MasterMonitorService.ts
import { Connection } from '@solana/web3.js';
import { PositionExitManager } from './PositionExitManager';

export interface TokenPriceUpdate {
  mint: string;
  priceNative: number;
  priceUsd: number;
  timestamp: number;
  source: 'helius' | 'jupiter' | 'dexscreener';
  slot: number;
}

export class MasterMonitorService {
  private connection: Connection;
  private exitManager: PositionExitManager;
  private subscribedMints = new Set<string>();
  private activeIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(rpcEndpoint: string, exitManager: PositionExitManager) {
    this.connection = new Connection(rpcEndpoint || 'https://api.mainnet-beta.solana.com', 'confirmed');
    this.exitManager = exitManager;
  }

  async startMonitoring(mints: string[]): Promise<void> {
    for (const mint of mints) {
      if (this.subscribedMints.has(mint)) continue;
      this.subscribedMints.add(mint);
      
      this.startPricePolling(mint);
    }
  }

  private startPricePolling(mint: string): void {
    if (this.activeIntervals.has(mint)) return;

    const poll = async () => {
      try {
        const response = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
        if (response.ok) {
          const data = await response.json();
          const priceData = data.data?.[mint];
          
          if (priceData?.price) {
            const priceNative = parseFloat(priceData.price);
            const update: TokenPriceUpdate = {
              mint,
              priceNative,
              priceUsd: priceNative * 150,
              timestamp: Date.now(),
              source: 'jupiter',
              slot: 0,
            };
            
            // 🔥 DIRECT PATH: Price update → Exit Manager (no polling delay)
            this.exitManager.onPriceUpdate(mint, update.priceNative, update.timestamp);
          }
        }
      } catch {
        // Silently handle polling errors
      }
    };
    
    // Initial poll
    poll();
    
    // Poll every 250ms for active tokens
    const interval = setInterval(poll, 250);
    this.activeIntervals.set(mint, interval);
  }

  stopMonitoring(mint?: string): void {
    if (mint) {
      this.subscribedMints.delete(mint);
      const interval = this.activeIntervals.get(mint);
      if (interval) {
        clearInterval(interval);
        this.activeIntervals.delete(mint);
      }
    } else {
      for (const interval of this.activeIntervals.values()) {
        clearInterval(interval);
      }
      this.activeIntervals.clear();
      this.subscribedMints.clear();
    }
  }
}
