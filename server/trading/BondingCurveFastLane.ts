// server/trading/BondingCurveFastLane.ts
import { MarketEvent } from '../market/EventNormalizer.js';
import { tokenMintResolver } from '../market/TokenMintResolver.js';

export interface BondingCurveState {
  mint: string;
  bondingCurve: string;
  virtualSolReservesLamports: bigint;
  virtualTokenReservesRaw: bigint;
  realSolReservesLamports: bigint;
  realTokenReservesRaw: bigint;
  bondingProgressPct: number;
  priceSolPerToken: number;
  hasVerifiedReserves: boolean;
  lastSlot: number;
  lastSignature: string;
  buyVelocity: number;
  sellVelocity: number;
  volumeVelocitySol: number;
  uniqueBuyerVelocity: number;
  lastUpdateTimestamp: number;
  createdAt: number;
}

export class BondingCurveFastLane {
  private static instance: BondingCurveFastLane;
  private cache: Map<string, BondingCurveState> = new Map();
  private eventLogs: Map<string, Array<{ type: 'buy' | 'sell'; solAmount: number; buyer: string; t: number }>> = new Map();
  
  // Pump.fun Constants
  private readonly INITIAL_VIRTUAL_SOL_LAMPORTS = 30_000_000_000n; // 30 SOL
  private readonly TARGET_RAISED_SOL_LAMPORTS = 55_000_000_000n;  // 55 SOL raised to graduate (85 SOL total)
  private readonly PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

  private constructor() {
    const interval = setInterval(() => this.pruneStaleData(), 60000);
    // FIX: Prevent interval from keeping the Node process alive during shutdown
    if (interval.unref) interval.unref(); 
  }

  public static getInstance(): BondingCurveFastLane {
    if (!BondingCurveFastLane.instance) {
      BondingCurveFastLane.instance = new BondingCurveFastLane();
    }
    return BondingCurveFastLane.instance;
  }

  public processEvent(event: MarketEvent): void {
    const mint = event.mint || (event as any).candidateMint;
    if (!mint || !tokenMintResolver.isValidMint(mint)) return;

    const now = Date.now();
    let state = this.cache.get(mint);
    const logs = event.raw?.transaction?.meta?.logMessages || event.raw?.logs || [];
    
    const isPumpFun = logs.some((l: string) => l.includes(this.PUMP_FUN_PROGRAM_ID));
    if (!isPumpFun) return;

    if (!state) {
      state = {
        mint,
        bondingCurve: event.pool || '',
        virtualSolReservesLamports: 0n,
        virtualTokenReservesRaw: 0n,
        realSolReservesLamports: 0n,
        realTokenReservesRaw: 0n,
        bondingProgressPct: 0,
        priceSolPerToken: event.price || 0,
        hasVerifiedReserves: false,
        lastSlot: event.slot,
        lastSignature: event.signature,
        buyVelocity: 0,
        sellVelocity: 0,
        volumeVelocitySol: 0,
        uniqueBuyerVelocity: 0,
        lastUpdateTimestamp: now,
        createdAt: now,
      };
      this.cache.set(mint, state);
    }

    state.lastSlot = event.slot;
    state.lastSignature = event.signature;
    state.lastUpdateTimestamp = now;

    let tradeType: 'buy' | 'sell' | null = null;
    let solVolume = 0;
    const buyerAddress = (event as any).buyer || (event as any).seller || event.owner || 'unknown';

    for (const log of logs) {
      if (log.includes('Instruction: Buy') || log.includes('Buy')) tradeType = 'buy';
      else if (log.includes('Instruction: Sell') || log.includes('Sell')) tradeType = 'sell';

      if (log.includes('virtual_sol_reserves')) {
        const solMatch = log.match(/virtual_sol_reserves:\s*(\d+)/);
        const tokMatch = log.match(/virtual_token_reserves:\s*(\d+)/);
        if (solMatch && tokMatch) {
          state.virtualSolReservesLamports = BigInt(solMatch[1]);
          state.virtualTokenReservesRaw = BigInt(tokMatch[1]);
          state.hasVerifiedReserves = true;
        }
      }
    }

    // FIX: Accurate SOL volume calculation (assuming event.tokenAmount is human-readable whole tokens)
    if (event.tokenAmount && event.price) {
      solVolume = event.tokenAmount * event.price;
    } else if (event.type === 'PRICE_UPDATE' && event.price) {
      state.priceSolPerToken = event.price;
    }

    // FIX: Precise BigInt math for Price and Progress
    if (state.hasVerifiedReserves && state.virtualTokenReservesRaw > 0n) {
      // Price in SOL = (Lamports / 1e9) / (RawTokens / 1e6) = (Lamports * 1e6) / (RawTokens * 1e9)
      const scaledLamportsPerToken = (state.virtualSolReservesLamports * 1000000n) / state.virtualTokenReservesRaw;
      state.priceSolPerToken = Number(scaledLamportsPerToken) / 1_000_000_000;

      const solRaisedLamports = state.virtualSolReservesLamports > this.INITIAL_VIRTUAL_SOL_LAMPORTS
        ? state.virtualSolReservesLamports - this.INITIAL_VIRTUAL_SOL_LAMPORTS
        : 0n;
      
      state.realSolReservesLamports = solRaisedLamports;
      state.bondingProgressPct = Math.min(100, Math.max(0, Number((solRaisedLamports * 10000n) / this.TARGET_RAISED_SOL_LAMPORTS) / 100));
    }

    if (tradeType) {
      let logsList = this.eventLogs.get(mint);
      if (!logsList) {
        logsList = [];
        this.eventLogs.set(mint, logsList);
      }
      logsList.push({ type: tradeType, solAmount: solVolume, buyer: buyerAddress, t: now });
    }

    this.calculateVelocities(mint);
  }

  private calculateVelocities(mint: string): void {
    const state = this.cache.get(mint);
    if (!state) return;

    const now = Date.now();
    const windowMs = 60000;
    const logsList = this.eventLogs.get(mint) || [];
    const active = logsList.filter(x => now - x.t <= windowMs);
    this.eventLogs.set(mint, active);

    const buys = active.filter(x => x.type === 'buy');
    const sells = active.filter(x => x.type === 'sell');

    state.buyVelocity = buys.length;
    state.sellVelocity = sells.length;
    state.volumeVelocitySol = active.reduce((sum, x) => sum + x.solAmount, 0);
    
    const uniqueBuyers = new Set(buys.map(x => x.buyer));
    state.uniqueBuyerVelocity = uniqueBuyers.size;
  }

  public getState(mint: string): BondingCurveState | undefined {
    return this.cache.get(mint);
  }

  public getAllStates(): BondingCurveState[] {
    return Array.from(this.cache.values());
  }

  private pruneStaleData(): void {
    const now = Date.now();
    const maxAgeMs = 15 * 60 * 1000;
    for (const [mint, state] of this.cache.entries()) {
      if (now - state.lastUpdateTimestamp > maxAgeMs) {
        this.cache.delete(mint);
        this.eventLogs.delete(mint);
      }
    }
  }

  public getMetrics(): any {
    return {
      trackedBondingCurvesCount: this.cache.size,
      highestProgressTokens: Array.from(this.cache.values())
        .sort((a, b) => b.bondingProgressPct - a.bondingProgressPct)
        .slice(0, 5)
        .map(x => ({ mint: x.mint, progress: x.bondingProgressPct, price: x.priceSolPerToken })),
    };
  }
}

export const bondingCurveFastLane = BondingCurveFastLane.getInstance();