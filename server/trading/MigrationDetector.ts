// server/trading/MigrationDetector.ts
import { MarketEvent } from '../market/EventNormalizer.js';
import { tokenMintResolver } from '../market/TokenMintResolver.js';

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
  buyVelocity: number; // trades/min
  sellVelocity: number; // trades/min
  volumeVelocitySol: number; // volume/min
  uniqueBuyersCount: number;
  liquidityAcceleration: number; // rate of liquidity growth
  postMigrationMomentumScore: number; // 0 to 100
  lastUpdateTimestamp: number;
  createdAt: number;
}

export class MigrationDetector {
  private static instance: MigrationDetector;
  private migratedPools: Map<string, MigratedPoolState> = new Map();
  private eventLogs: Map<string, Array<{ type: 'buy' | 'sell'; solAmount: number; buyer: string; t: number }>> = new Map();

  private constructor() {
    setInterval(() => this.pruneStalePools(), 120000);
  }

  public static getInstance(): MigrationDetector {
    if (!MigrationDetector.instance) {
      MigrationDetector.instance = new MigrationDetector();
    }
    return MigrationDetector.instance;
  }

  /**
   * Parses log messages to detect real-time pool initialization/migration events on-chain.
   */
  public processEvent(event: MarketEvent): MigratedPoolState | null {
    const mint = event.mint || (event as any).candidateMint;
    if (!mint || !tokenMintResolver.isValidMint(mint)) return null;

    const logs = event.raw?.transaction?.meta?.logMessages || event.raw?.logs || [];
    const isRaydiumInit = logs.some((l: string) => l.includes('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') && (l.includes('initialize2') || l.includes('Initialize')));
    const isMeteoraInit = logs.some((l: string) => l.includes('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB') && l.includes('initialize_pool'));

    let state = this.migratedPools.get(mint);

    if ((isRaydiumInit || isMeteoraInit) && !state) {
      const poolType = isRaydiumInit ? 'raydium' : 'meteora';
      const initialLiq = 79; // Raydium standard Pump.fun migration is ~79 SOL of initial liquidity

      state = {
        mint,
        sourceBondingCurve: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        destinationPool: event.pool || 'unknown_pool',
        poolType,
        migrationSlot: event.slot,
        migrationSignature: event.signature,
        initialLiquiditySol: initialLiq,
        currentLiquiditySol: initialLiq,
        priceImmediatelyAfterMigration: event.price || 0.000001,
        priceCurrent: event.price || 0.000001,
        buyVelocity: 0,
        sellVelocity: 0,
        volumeVelocitySol: 0,
        uniqueBuyersCount: 0,
        liquidityAcceleration: 0,
        postMigrationMomentumScore: 0,
        lastUpdateTimestamp: Date.now(),
        createdAt: Date.now(),
      };

      this.migratedPools.set(mint, state);
      console.log(`[MIGRATION FAST LANE] Detected ${poolType.toUpperCase()} migration for ${mint}! Slot: ${event.slot}, Pool: ${state.destinationPool}`);
      return state;
    }

    if (state) {
      state.lastUpdateTimestamp = Date.now();
      if (event.slot) state.migrationSlot = event.slot;
      if (event.price) {
        state.priceCurrent = event.price;
      }

      // Track post-migration buys & sells
      let tradeType: 'buy' | 'sell' | null = null;
      let solAmount = 0;
      const buyer = event.owner || 'unknown';

      const logStr = logs.join(' ');
      if (logStr.includes('Buy') || logStr.includes('swap_exact_tokens_for_tokens') || logStr.includes('swap')) {
        tradeType = 'buy';
      } else if (logStr.includes('Sell')) {
        tradeType = 'sell';
      }

      if (event.tokenAmount && event.price) {
        solAmount = event.tokenAmount * event.price;
      }

      if (tradeType) {
        let logsList = this.eventLogs.get(mint);
        if (!logsList) {
          logsList = [];
          this.eventLogs.set(mint, logsList);
        }
        logsList.push({ type: tradeType, solAmount, buyer, t: Date.now() });
      }

      this.updateMetrics(mint);
    }

    return state || null;
  }

  private updateMetrics(mint: string): void {
    const state = this.migratedPools.get(mint);
    if (!state) return;

    const now = Date.now();
    const windowMs = 60000; // 1 min window
    const logsList = this.eventLogs.get(mint) || [];

    const active = logsList.filter(x => now - x.t <= windowMs);
    this.eventLogs.set(mint, active);

    const buys = active.filter(x => x.type === 'buy');
    const sells = active.filter(x => x.type === 'sell');

    state.buyVelocity = buys.length;
    state.sellVelocity = sells.length;
    state.volumeVelocitySol = active.reduce((sum, x) => sum + x.solAmount, 0);
    state.uniqueBuyersCount = new Set(buys.map(x => x.buyer)).size;

    // Liquidity acceleration: growth rate in SOL liquidity
    const liqGrowth = state.volumeVelocitySol * 0.1; // estimate liquidity retention (LP additions/pool reserves)
    state.currentLiquiditySol = state.initialLiquiditySol + liqGrowth;
    state.liquidityAcceleration = liqGrowth;

    // Calculate Momentum using MigrationMomentumEngine
    state.postMigrationMomentumScore = MigrationMomentumEngine.calculateScore(state);
  }

  public getMigratedPool(mint: string): MigratedPoolState | undefined {
    return this.migratedPools.get(mint);
  }

  public getAllMigratedPools(): MigratedPoolState[] {
    return Array.from(this.migratedPools.values());
  }

  private pruneStalePools(): void {
    const now = Date.now();
    const maxAgeMs = 30 * 60 * 1000; // 30 minutes TTL for migration tracking

    for (const [mint, state] of this.migratedPools.entries()) {
      if (now - state.createdAt > maxAgeMs) {
        this.migratedPools.delete(mint);
        this.eventLogs.delete(mint);
      }
    }
  }
}

export class MigrationMomentumEngine {
  /**
   * Generates a 0-100 score indicating migration-level momentum
   */
  public static calculateScore(pool: MigratedPoolState): number {
    let score = 50; // Base score for recently migrated tokens

    // 1. Velocity bonus (up to +25)
    const txRate = pool.buyVelocity + pool.sellVelocity;
    score += Math.min(25, txRate * 0.5);

    // 2. Buy/Sell balance bonus (up to +15)
    if (pool.buyVelocity > pool.sellVelocity) {
      const ratio = pool.buyVelocity / Math.max(1, pool.sellVelocity);
      score += Math.min(15, ratio * 3);
    } else {
      score -= Math.min(20, (pool.sellVelocity / Math.max(1, pool.buyVelocity)) * 3);
    }

    // 3. Liquidity growth bonus (up to +10)
    if (pool.liquidityAcceleration > 0) {
      score += Math.min(10, pool.liquidityAcceleration * 2);
    }

    // 4. Volume acceleration bonus (up to +10)
    score += Math.min(10, pool.volumeVelocitySol * 1.5);

    return Math.max(0, Math.min(100, score));
  }
}

export const migrationDetector = MigrationDetector.getInstance();
