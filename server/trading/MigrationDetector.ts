// server/trading/MigrationDetector.ts
import { MarketEvent } from '../market/EventNormalizer.js';
import { tokenMintResolver } from '../market/TokenMintResolver.js';
import { logger } from '../utils/logger.js';

export interface MigratedPoolState {
  mint: string;
  sourceBondingCurve?: string;
  destinationPool: string;
  poolType: 'raydium' | 'meteora' | 'orca' | 'unknown';
  migrationSlot: number;
  migrationSignature: string;
  initialLiquiditySol: number;
  currentLiquiditySol: number;
  priceImmediatelyAfterMigration: number;
  priceCurrent: number;
  buyVelocity: number;
  sellVelocity: number;
  volumeVelocitySol: number;
  uniqueBuyersCount: number;
  liquidityAcceleration: number;
  postMigrationMomentumScore: number;
  lastUpdateTimestamp: number;
  createdAt: number;
}

// Known DEX program IDs
const RAYDIUM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const RAYDIUM_CPMM = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
const METEORA_DLMM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const METEORA_DBC = 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB';
const PUMP_FUN_FEE = 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM';

export class MigrationDetector {
  private static instance: MigrationDetector;
  private migratedPools: Map<string, MigratedPoolState> = new Map();
  private eventLogs: Map<string, Array<{ type: 'buy' | 'sell'; solAmount: number; buyer: string; t: number }>> = new Map();

  private constructor() {
    // FIX: Periodic cleanup with .unref() to prevent memory leaks
    const cleanupInterval = setInterval(() => this.pruneStalePools(), 120000);
    if (cleanupInterval.unref) cleanupInterval.unref();
  }

  public static getInstance(): MigrationDetector {
    if (!MigrationDetector.instance) {
      MigrationDetector.instance = new MigrationDetector();
    }
    return MigrationDetector.instance;
  }

  // ==========================================
  // EVENT PROCESSING
  // ==========================================

  public processEvent(event: MarketEvent): MigratedPoolState | null {
    const mint = event.mint || (event as any).candidateMint;
    if (!mint || !tokenMintResolver.isValidMint(mint)) return null;

    const logs = event.raw?.transaction?.meta?.logMessages || event.raw?.logs || [];
    const isRaydiumInit = logs.some((l: string) =>
      (l.includes(RAYDIUM_V4) || l.includes(RAYDIUM_CPMM)) &&
      (l.includes('initialize2') || l.includes('Initialize') || l.includes('init_pool'))
    );
    const isMeteoraInit = logs.some((l: string) =>
      (l.includes(METEORA_DLMM) || l.includes(METEORA_DBC)) &&
      (l.includes('initialize_pool') || l.includes('InitializeLbPair'))
    );

    let state = this.migratedPools.get(mint);

    if ((isRaydiumInit || isMeteoraInit) && !state) {
      const poolType = isRaydiumInit ? 'raydium' : 'meteora';
      const initialLiq = (event as any).liquiditySol || 0;

      state = {
        mint,
        destinationPool: (event as any).pool || 'unknown',
        poolType,
        migrationSlot: event.slot || 0,
        migrationSignature: event.signature || '',
        initialLiquiditySol: initialLiq,
        currentLiquiditySol: initialLiq,
        priceImmediatelyAfterMigration: event.priceSol || 0,
        priceCurrent: event.priceSol || 0,
        buyVelocity: 0,
        sellVelocity: 0,
        volumeVelocitySol: 0,
        uniqueBuyersCount: 0,
        liquidityAcceleration: 0,
        postMigrationMomentumScore: 50,
        lastUpdateTimestamp: Date.now(),
        createdAt: Date.now(),
      };

      this.migratedPools.set(mint, state);
      logger.info({ mint, poolType, signature: event.signature }, '[MigrationDetector] MIGRATION DETECTED');
      return state;
    }

    if (state) {
      this.updatePostMigrationMetrics(state, event);
    }

    return state || null;
  }

  // ==========================================
  // METRICS UPDATE
  // ==========================================

  private updatePostMigrationMetrics(state: MigratedPoolState, event: MarketEvent): void {
    const now = Date.now();
    state.lastUpdateTimestamp = now;

    if (event.priceSol && event.priceSol > 0) {
      state.priceCurrent = event.priceSol;
    }

    let logs = this.eventLogs.get(state.mint);
    if (!logs) {
      logs = [];
      this.eventLogs.set(state.mint, logs);
    }

    if (event.type === 'trade' || event.type === 'swap') {
      const isBuy = event.side === 'buy' || (event as any).isBuy === true;
      logs.push({
        type: isBuy ? 'buy' : 'sell',
        solAmount: (event as any).solAmount || 0,
        buyer: (event as any).maker || (event as any).wallet || 'unknown',
        t: now,
      });
    }

    // Rolling 1-minute window
    const windowStart = now - 60000;
    const recent = logs.filter(l => l.t >= windowStart);
    this.eventLogs.set(state.mint, recent);

    const buys = recent.filter(l => l.type === 'buy');
    const sells = recent.filter(l => l.type === 'sell');
    state.buyVelocity = buys.length;
    state.sellVelocity = sells.length;
    state.volumeVelocitySol = recent.reduce((sum, l) => sum + l.solAmount, 0);
    state.uniqueBuyersCount = new Set(buys.map(l => l.buyer)).size;

    // Calculate post-migration momentum (0-100)
    let score = 50;
    if (state.priceImmediatelyAfterMigration > 0) {
      const priceChange = ((state.priceCurrent - state.priceImmediatelyAfterMigration) / state.priceImmediatelyAfterMigration) * 100;
      score += Math.min(25, Math.max(-25, priceChange));
    }
    if (state.buyVelocity > state.sellVelocity * 2) score += 15;
    if (state.uniqueBuyersCount > 5) score += 10;

    state.postMigrationMomentumScore = Math.max(0, Math.min(100, Math.round(score)));
  }

  // ==========================================
  // QUERIES
  // ==========================================

  public getMigratedPool(mint: string): MigratedPoolState | undefined {
    return this.migratedPools.get(mint.trim());
  }

  public getPoolState(mint: string): MigratedPoolState | undefined {
    return this.getMigratedPool(mint);
  }

  public getAllMigratedPools(): MigratedPoolState[] {
    return Array.from(this.migratedPools.values());
  }

  // ==========================================
  // CLEANUP
  // ==========================================

  private pruneStalePools(): void {
    const cutoff = Date.now() - 3600000; // 1 hour
    for (const [mint, pool] of this.migratedPools.entries()) {
      if (pool.lastUpdateTimestamp < cutoff) {
        this.migratedPools.delete(mint);
        this.eventLogs.delete(mint);
      }
    }
  }

  public clear(): void {
    this.migratedPools.clear();
    this.eventLogs.clear();
  }
}

export const migrationDetector = MigrationDetector.getInstance();
