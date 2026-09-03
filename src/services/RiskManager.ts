// src/services/RiskManager.ts
import { systemLogger } from './systemLogger';

export interface ManagedPosition {
  mint: string;
  amount: number; // Raw token integer base units
  tokenDecimals: number;
  buyPrice: number; // Entry price in SOL per human token unit
  solSpent: number; // Cumulative cost basis in SOL
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  slippageBpsTp?: number;
  slippageBpsSl?: number;
  currentPrice: number; // Current market price in SOL
  peakPrice?: number;
  highestPnLPct?: number;
  state: 'PENDING_BUY' | 'OPEN' | 'EXIT_REQUESTED' | 'CLOSING' | 'CLOSED' | 'RECONCILIATION_REQUIRED' | 'RECOVERY_REQUIRED';
  buySignature?: string;
  buySlot?: number;
  createdAt: number;
  lastPriceUpdate?: number;
  pendingSince?: number;
  activePriceSource?: 'jupiter';
  exitAttempts?: number;
  lastExitAttempt?: number;
  exitCooldownUntil?: number;
  lastExitError?: string;
  reconciliationRequired?: boolean;
}

export interface RiskConfig {
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  maxOpenPositions?: number;
  slippageBpsTp?: number;
  slippageBpsSl?: number;
}

export class RiskManager {
  private static instance: RiskManager;
  private positions: Map<string, ManagedPosition> = new Map();
  private config: RiskConfig = {
    tpPct: 25,
    slPct: 15,
    trailingSlPct: 10,
    maxHoldTimeMs: 0,
    maxOpenPositions: 10,
    slippageBpsTp: 250,
    slippageBpsSl: 1000,
  };

  private isRunning: boolean = false;

  private constructor() {}

  public static getInstance(): RiskManager {
    if (!RiskManager.instance) {
      RiskManager.instance = new RiskManager();
    }
    return RiskManager.instance;
  }

  public start(): void {
    this.isRunning = true;
    console.log('[RiskManager] Client-side RiskManager started in PASSIVE read-only mode.');
  }

  public stop(): void {
    this.isRunning = false;
  }

  public canOpenNewPosition(): boolean {
    return true;
  }

  public addPosition(params: any): void {
    // Sync-only client-side position cache
    const pos: ManagedPosition = {
      mint: params.mint,
      amount: params.amount || 0,
      tokenDecimals: params.tokenDecimals || 9,
      buyPrice: params.buyPrice || 0,
      solSpent: params.solSpent || 0,
      tpPct: params.tpPct || this.config.tpPct,
      slPct: params.slPct || this.config.slPct,
      currentPrice: params.currentPrice || params.buyPrice || 0,
      state: 'OPEN',
      createdAt: Date.now(),
    };
    this.positions.set(params.mint, pos);
  }

  public confirmBuy(mint: string, signature: string): void {
    const pos = this.positions.get(mint);
    if (pos) {
      pos.state = 'OPEN';
      pos.buySignature = signature;
    }
  }

  public removePosition(mint: string): void {
    this.positions.delete(mint);
  }

  public getPosition(mint: string): ManagedPosition | undefined {
    return this.positions.get(mint);
  }

  public getAllPositions(): ManagedPosition[] {
    return Array.from(this.positions.values());
  }

  public updatePositionTpSl(mint: string, tpPct: number, slPct: number): void {
    const pos = this.positions.get(mint);
    if (pos) {
      pos.tpPct = tpPct;
      pos.slPct = slPct;
    }
  }

  public onPriceUpdate(mint: string, rawPrice: number): void {
    const pos = this.positions.get(mint);
    if (pos) {
      pos.currentPrice = rawPrice;
    }
  }

  /**
   * Request manual exit: delegates strictly to the server-side sell API endpoint.
   */
  public async requestExit(mint: string, reason: string = 'MANUAL_EXIT'): Promise<void> {
    systemLogger.info('SELL', `[RiskManager] User initiated manual exit for ${mint}. Forwarding to server...`);
    
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
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Request rejected by trading server');
      }

      systemLogger.info('SELL', `[RiskManager] Manual exit authorized and submitted by server for ${mint}.`);
    } catch (err: any) {
      systemLogger.error('SELL', `[RiskManager] Manual exit request failed: ${err.message || err}`);
      throw err;
    }
  }

  public getPositions(): Map<string, ManagedPosition> {
    return new Map(this.positions);
  }
}

export const riskManager = RiskManager.getInstance();
