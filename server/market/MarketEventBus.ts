// server/market/MarketEventBus.ts
import { MarketEvent } from './EventNormalizer.js';
import { UnifiedMarketEvent } from '../types/index.js';
import { sourceHealthMonitor } from './SourceHealthMonitor.js';
import { candidateRegistry } from './CandidateRegistry.js';
import { bondingCurveFastLane } from '../trading/BondingCurveFastLane.js';
import { migrationDetector } from '../trading/MigrationDetector.js';
import { momentumEngine } from '../trading/MomentumEngine.js';
import { entryEngine } from '../trading/EntryEngine.js';

export type MarketEventListener = (event: MarketEvent) => void;
export type UnifiedEventListener = (event: UnifiedMarketEvent) => void;

export class MarketEventBus {
  private static instance: MarketEventBus;
  private listeners: Set<MarketEventListener> = new Set();
  private unifiedListeners: Set<UnifiedEventListener> = new Set();

  private constructor() {}

  public static getInstance(): MarketEventBus {
    if (!MarketEventBus.instance) {
      MarketEventBus.instance = new MarketEventBus();
    }
    return MarketEventBus.instance;
  }

  public subscribe(listener: MarketEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public subscribeUnified(listener: UnifiedEventListener): () => void {
    this.unifiedListeners.add(listener);
    return () => this.unifiedListeners.delete(listener);
  }

  /**
   * Publishes legacy MarketEvent.
   */
  public publish(event: MarketEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[MARKET EVENT BUS ERROR]', err);
      }
    }
  }

  /**
   * Authoritative Unified Ingress: publishes UnifiedMarketEvent across all listeners,
   * updates health telemetry, candidate registry, fast lanes, momentum engine, and triggers evaluation.
   */
  public publishUnified(event: UnifiedMarketEvent): void {
    // 1. Health monitoring
    sourceHealthMonitor.recordEvent(event.source);

    // 2. Deduplication & Candidate Registry
    if (candidateRegistry.isEventDuplicate(event.eventId)) {
      return;
    }
    candidateRegistry.markEventProcessed(event.eventId);

    const { candidate, isNewCandidate } = candidateRegistry.registerOrUpdateCandidate(
      event,
      event.network || 'mainnet'
    );

    // 3. Fast-lane ingestion
    if (event.source === 'PUMP_FUN' || event.protocol === 'PUMP_FUN' || event.eventType === 'BONDING_TRADE') {
      bondingCurveFastLane.processEvent({
        mint: event.mint,
        signature: event.signature || 'none',
        slot: event.slot || 0,
        type: event.eventType === 'TOKEN_DISCOVERED' ? 'SLOT_UPDATE' : 'ON_CHAIN_TX',
        network: event.network || 'mainnet',
        timestamp: event.timestamp,
        raw: event.raw,
      } as any);
    }

    if (event.eventType === 'MIGRATION' || event.protocol?.includes('RAYDIUM') || event.protocol?.includes('METEORA')) {
      migrationDetector.processEvent({
        mint: event.mint,
        signature: event.signature || 'none',
        slot: event.slot || 0,
        type: 'ON_CHAIN_TX',
        network: event.network || 'mainnet',
        timestamp: event.timestamp,
        protocol: event.protocol,
        raw: event.raw,
      } as any);
    }

    // 4. Momentum Engine real-time trade recording
    if (event.priceSol && event.priceSol > 0) {
      const isBuy = event.side === 'BUY';
      const solAmount = event.solAmount ? Number(event.solAmount) : 0;
      momentumEngine.recordTrade(event.mint, event.priceSol, isBuy, solAmount, event.buyer || event.seller || 'unknown');
    }

    // 5. Notify unified subscribers
    for (const listener of this.unifiedListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[UNIFIED EVENT BUS LISTENER ERROR]', err);
      }
    }

    // 6. Automatically dispatch new or high-priority candidates to EntryEngine if auto-trading is active
    if (isNewCandidate || event.eventType === 'TOKEN_DISCOVERED' || event.eventType === 'BONDING_TRADE' || event.eventType === 'MIGRATION') {
      const config = entryEngine.getConfig();
      if (config.isRunning || config.autoSniperEnabled) {
        entryEngine.evaluateAndTrade(event.mint, event.source).catch((err) => {
          console.warn(`[ENTRY DISPATCH ERROR] mint=${event.mint}:`, err.message);
        });
      }
    }
  }
}

export const marketEventBus = MarketEventBus.getInstance();

