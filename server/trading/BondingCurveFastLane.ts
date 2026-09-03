// server/trading/BondingCurveFastLane.ts
import { MarketEvent } from '../market/EventNormalizer.js';
import { tokenMintResolver } from '../market/TokenMintResolver.js';

export interface BondingCurveState {
  mint: string;
  bondingCurve: string;
  virtualSolReserves: number; // in SOL
  virtualTokenReserves: number; // in tokens
  realSolReserves: number; // in SOL
  realTokenReserves: number; // in tokens
  bondingProgress: number; // 0 to 100
  price: number; // in SOL per token
  lastSlot: number;
  lastSignature: string;
  buyVelocity: number; // trades per min
  sellVelocity: number; // trades per min
  volumeVelocity: number; // SOL volume per min
  uniqueBuyerVelocity: number;
  graduationProbability: number; // 0 to 100
  lastUpdateTimestamp: number;
  createdAt: number;
}

export class BondingCurveFastLane {
  private static instance: BondingCurveFastLane;
  private cache: Map<string, BondingCurveState> = new Map();
  
  // Rolling event logs for velocity calculations
  private eventLogs: Map<string, Array<{ type: 'buy' | 'sell'; solAmount: number; buyer: string; t: number }>> = new Map();

  private constructor() {
    // Periodically prune stale cache entries (e.g. inactive for > 15 mins) and velocity logs
    setInterval(() => this.pruneStaleData(), 60000);
  }

  public static getInstance(): BondingCurveFastLane {
    if (!BondingCurveFastLane.instance) {
      BondingCurveFastLane.instance = new BondingCurveFastLane();
    }
    return BondingCurveFastLane.instance;
  }

  /**
   * Process incoming on-chain LaserStream and WSS events.
   * Leverages protocol-aware log mining and event parsing.
   */
  public processEvent(event: MarketEvent): void {
    const mint = event.mint || (event as any).candidateMint;
    if (!mint || !tokenMintResolver.isValidMint(mint)) return;

    const now = Date.now();
    let state = this.cache.get(mint);

    // Parse pump.fun specific logs if available
    const logs = event.raw?.transaction?.meta?.logMessages || event.raw?.logs || [];
    const isPumpFun = logs.some((l: string) => l.includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'));

    if (!isPumpFun) return;

    if (!state) {
      state = {
        mint,
        bondingCurve: event.pool || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        virtualSolReserves: 30, // Default starting virtual SOL reserves
        virtualTokenReserves: 1073000000, // Default starting virtual token reserves
        realSolReserves: 0,
        realTokenReserves: 793000000,
        bondingProgress: 0,
        price: 30 / 1073000000,
        lastSlot: event.slot,
        lastSignature: event.signature,
        buyVelocity: 0,
        sellVelocity: 0,
        volumeVelocity: 0,
        uniqueBuyerVelocity: 0,
        graduationProbability: 0,
        lastUpdateTimestamp: now,
        createdAt: now,
      };
      this.cache.set(mint, state);
    }

    state.lastSlot = event.slot;
    state.lastSignature = event.signature;
    state.lastUpdateTimestamp = now;

    // Detect trade events and update reserves
    let tradeType: 'buy' | 'sell' | null = null;
    let solVolume = 0;
    let buyerAddress = event.owner || 'unknown';

    for (const log of logs) {
      if (log.includes('Program log: Instruction: Buy') || log.includes('Buy')) {
        tradeType = 'buy';
      } else if (log.includes('Program log: Instruction: Sell') || log.includes('Sell')) {
        tradeType = 'sell';
      }

      // Try to parse virtual reserves from custom logs if emitted
      // Format: "Program log: virtual_sol_reserves: 30000000000, virtual_token_reserves: 1073000000000000"
      if (log.includes('virtual_sol_reserves')) {
        const solMatch = log.match(/virtual_sol_reserves:\s*(\d+)/);
        const tokMatch = log.match(/virtual_token_reserves:\s*(\d+)/);
        if (solMatch) state.virtualSolReserves = Number(solMatch[1]) / 1e9;
        if (tokMatch) state.virtualTokenReserves = Number(tokMatch[1]) / 1e6;
      }
    }

    // Estimate based on event payload if explicit logs didn't contain reserves
    if (event.tokenAmount && event.price) {
      solVolume = event.tokenAmount * event.price;
      if (tradeType === 'buy') {
        state.virtualSolReserves += solVolume;
        state.virtualTokenReserves -= event.tokenAmount;
      } else if (tradeType === 'sell') {
        state.virtualSolReserves = Math.max(30, state.virtualSolReserves - solVolume);
        state.virtualTokenReserves += event.tokenAmount;
      }
    } else if (event.type === 'PRICE_UPDATE' && event.price) {
      state.price = event.price;
    }

    // Recalculate price dynamically
    if (state.virtualTokenReserves > 0) {
      state.price = state.virtualSolReserves / state.virtualTokenReserves;
    }

    // Bonding curve progress is calculated on Pump.fun as virtualSolReserves reaching 85 SOL (30 SOL start + 55 SOL real raised)
    // Progress % = (virtualSolReserves - 30) / 55 * 100 (capped at 100%)
    const solRaised = Math.max(0, state.virtualSolReserves - 30);
    state.bondingProgress = Math.min(100, Math.max(0, (solRaised / 55) * 100));
    state.realSolReserves = solRaised;
    state.realTokenReserves = Math.max(0, 793000000 - (1073000000 - state.virtualTokenReserves));

    // Calculate graduation probability (momentum and volume acceleration towards 100% completion)
    state.graduationProbability = state.bondingProgress;

    // Track velocities in a 1-minute rolling window
    if (tradeType) {
      let logsList = this.eventLogs.get(mint);
      if (!logsList) {
        logsList = [];
        this.eventLogs.set(mint, logsList);
      }
      logsList.push({ type: tradeType, solAmount: solVolume || (event.price ? (event.tokenAmount || 0) * event.price : 0), buyer: buyerAddress, t: now });
    }

    this.calculateVelocities(mint);
  }

  private calculateVelocities(mint: string): void {
    const state = this.cache.get(mint);
    if (!state) return;

    const now = Date.now();
    const windowMs = 60000; // 1-minute rolling window
    const logsList = this.eventLogs.get(mint) || [];

    // Filter events in window
    const active = logsList.filter(x => now - x.t <= windowMs);
    this.eventLogs.set(mint, active);

    const buys = active.filter(x => x.type === 'buy');
    const sells = active.filter(x => x.type === 'sell');

    state.buyVelocity = buys.length;
    state.sellVelocity = sells.length;
    state.volumeVelocity = active.reduce((sum, x) => sum + x.solAmount, 0);

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
    const maxAgeMs = 15 * 60 * 1000; // 15 mins TTL

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
        .sort((a, b) => b.bondingProgress - a.bondingProgress)
        .slice(0, 5)
        .map(x => ({ mint: x.mint, progress: x.bondingProgress, price: x.price })),
    };
  }
}

export const bondingCurveFastLane = BondingCurveFastLane.getInstance();
