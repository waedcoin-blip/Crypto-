// server/market/MarketEventBus.ts
import { EventEmitter } from 'events';
import { UnifiedMarketEvent } from '../types/index.js';

type MarketEventHandler = (event: UnifiedMarketEvent) => void;

/**
 * Central Authoritative Market Event Bus.
 * All normalized market events flow through this single bus.
 * Subscribers: BondingCurveFastLane, MigrationDetector, MomentumEngine,
 *              CandidateEnricher, EntryEngine, LaserStreamPipeline
 */
export class MarketEventBus extends EventEmitter {
  private static instance: MarketEventBus;
  private totalPublished: number = 0;
  private totalDropped: number = 0;
  private readonly MAX_QUEUE_SIZE = 10000;

  private constructor() {
    super();
    // Allow many listeners (multiple engines subscribe)
    this.setMaxListeners(50);
  }

  public static getInstance(): MarketEventBus {
    if (!MarketEventBus.instance) {
      MarketEventBus.instance = new MarketEventBus();
    }
    return MarketEventBus.instance;
  }

  /**
   * Publish a unified market event to all subscribers.
   */
  public publishUnified(event: UnifiedMarketEvent): void {
    if (!event || !event.mint || !event.eventId) {
      this.totalDropped++;
      return;
    }

    if (this.listenerCount('UNIFIED_EVENT') > 0) {
      this.totalPublished++;
      try {
        this.emit('UNIFIED_EVENT', event);
      } catch (err: any) {
        console.error(`[MarketEventBus] Error emitting UNIFIED_EVENT for ${event.mint}:`, err);
      }
    }

    // Also emit on mint-specific channel for targeted subscribers
    this.emit(`mint:${event.mint}`, event);
  }

  public publish(event: UnifiedMarketEvent): void {
    this.publishUnified(event);
  }

  /**
   * Subscribe to all unified events.
   * Returns an unsubscribe function.
   */
  public subscribe(handler: MarketEventHandler): () => void {
    this.on('UNIFIED_EVENT', handler);
    return () => this.off('UNIFIED_EVENT', handler);
  }

  public subscribeUnified(handler: MarketEventHandler): () => void {
    return this.subscribe(handler);
  }

  /**
   * Subscribe to events for a specific mint.
   * Returns an unsubscribe function.
   */
  public subscribeToMint(mint: string, handler: MarketEventHandler): () => void {
    const channel = `mint:${mint}`;
    this.on(channel, handler);
    return () => this.off(channel, handler);
  }

  /**
   * Get bus telemetry.
   */
  public getTelemetry() {
    return {
      totalPublished: this.totalPublished,
      totalDropped: this.totalDropped,
      activeListeners: this.listenerCount('UNIFIED_EVENT'),
      maxListeners: this.getMaxListeners(),
    };
  }

  /**
   * Remove all listeners (used during shutdown).
   */
  public shutdown(): void {
    this.removeAllListeners();
    console.log('[MarketEventBus] All listeners removed. Bus shut down.');
  }
}

export const marketEventBus = MarketEventBus.getInstance();
