// src/services/UltraFastExitEngine.ts
import { systemLogger } from './systemLogger';

export interface MarketPriceEvent {
  mint: string;
  priceSol: number;
  timestamp?: number;
}

export interface ManualExitRequestParams {
  positionId?: string;
  mint?: string;
  reason?: string;
  sellRatio?: number;
  priority?: number;
}

export class UltraFastExitEngine {
  private static instance: UltraFastExitEngine;

  private constructor() {}

  public static getInstance(): UltraFastExitEngine {
    if (!UltraFastExitEngine.instance) {
      UltraFastExitEngine.instance = new UltraFastExitEngine();
    }
    return UltraFastExitEngine.instance;
  }

  /**
   * Client-side price listener: purely passive now, as all exit decisions have been moved to the server-side UnifiedExitEngine.
   */
  public onMarketPriceEvent(event: MarketPriceEvent): void {
    // Passive read-only - Server-side UnifiedExitEngine is the sole evaluator of automatic exits.
  }

  /**
   * Authoritative manual exit trigger entry point: relays request to the server-side sell API.
   */
  public async requestExit(params: ManualExitRequestParams): Promise<boolean> {
    const { mint, reason = 'MANUAL_EXIT' } = params;
    if (!mint) return false;

    systemLogger.info('SELL', `[UltraFastExitEngine] Relaying manual exit request for ${mint} to server-side authority.`);

    try {
      const response = await fetch('/api/trading/sell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mint,
          reason,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        systemLogger.info('SELL', `[UltraFastExitEngine] Server successfully executed manual exit for ${mint}.`);
        return true;
      } else {
        systemLogger.error('SELL', `[UltraFastExitEngine] Server failed manual exit for ${mint}: ${data.error}`);
        return false;
      }
    } catch (err: any) {
      systemLogger.error('SELL', `[UltraFastExitEngine] Network error while requesting exit for ${mint}: ${err.message || err}`);
      return false;
    }
  }

  public configurePositionRules(positionId: string, config: any): void {
    // No-op client-side
  }

  public getLatencyMetrics(): any[] {
    return [];
  }

  public clearMemory(positionId: string): void {
    // No-op client-side
  }
}

export const ultraFastExitEngine = UltraFastExitEngine.getInstance();
