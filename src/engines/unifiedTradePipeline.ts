// src/engines/unifiedTradePipeline.ts
import { Trade } from '../types';
import { systemLogger } from '../services/systemLogger';
import { tokenLifecycleManager } from '../services/TokenLifecycleManager';

export type TradeSource = 'PULSE_FEED' | 'WSS' | 'DEXSCREENER' | 'LASERSTREAM' | 'MANUAL' | 'SIMULATION';
export type TradeType = 'BUY' | 'SELL';

export interface NormalizedTradeEvent {
  eventId: string;
  source: TradeSource;
  type: TradeType;
  mint: string;
  symbol: string;
  wallet?: string;
  amount: number;
  decimals?: number;
  price?: number;
  liquidity?: number;
  signature?: string;
  slot?: number;
  timestamp: number;
  dex?: string;
  confidence?: number;
  rawTrade?: Trade;
}

export type PipelineListener = (event: NormalizedTradeEvent) => void;

/**
 * UnifiedTradePipeline:
 * The single authoritative ingress gateway for all market trade events across all feeds.
 * Guarantees event-level deduplication, system log broadcasting, token lifecycle tracking,
 * and decoupling of observed events from trading execution.
 */
class UnifiedTradePipeline {
  private static instance: UnifiedTradePipeline;
  private listeners: Set<PipelineListener> = new Set();
  private processedEventIds: Set<string> = new Set();
  private readonly maxEventIds = 30000;

  private constructor() {}

  public static getInstance(): UnifiedTradePipeline {
    if (!UnifiedTradePipeline.instance) {
      UnifiedTradePipeline.instance = new UnifiedTradePipeline();
    }
    return UnifiedTradePipeline.instance;
  }

  public subscribe(listener: PipelineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public ingestPulseFeed(trade: Trade): NormalizedTradeEvent | null {
    return this.ingest(trade, 'PULSE_FEED');
  }

  public ingest(
    input: NormalizedTradeEvent | Trade,
    sourceOverride?: TradeSource
  ): NormalizedTradeEvent | null {
    const event = this.normalize(input, sourceOverride);
    if (!event || !event.mint) return null;

    // Event-level deduplication
    if (this.processedEventIds.has(event.eventId)) {
      systemLogger.debug('PIPELINE', `[EVENT_DUPLICATE] Duplicate event dropped: ${event.eventId}`, {
        eventId: event.eventId,
        mint: event.mint,
        source: event.source,
      });
      return null;
    }

    // Mark event ID as processed with LRU eviction
    this.processedEventIds.add(event.eventId);
    if (this.processedEventIds.size > this.maxEventIds) {
      const oldest = this.processedEventIds.values().next().value;
      if (oldest) this.processedEventIds.delete(oldest);
    }

    // Log acceptance in System Logger
    systemLogger.info('PIPELINE', `[EVENT_ACCEPTED] Ingested ${event.type} for ${event.symbol} (${event.mint.slice(0, 8)}...) via ${event.source}`, {
      eventId: event.eventId,
      mint: event.mint,
      symbol: event.symbol,
      source: event.source,
      signature: event.signature,
      eventType: 'EVENT_ACCEPTED',
      metadata: { amount: event.amount },
    });

    // Update Token Lifecycle State (Observed in market feed)
    tokenLifecycleManager.markDiscovered(event.mint, event.symbol);

    // Broadcast to pipeline listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[UNIFIED_TRADE_PIPELINE] Pipeline listener error:', error);
      }
    }

    return event;
  }

  private normalize(
    input: NormalizedTradeEvent | Trade,
    sourceOverride?: TradeSource
  ): NormalizedTradeEvent {
    const now = Date.now();

    // If already normalized:
    if ('eventId' in input && input.eventId) {
      return {
        ...input,
        source: sourceOverride || input.source || 'PULSE_FEED',
        timestamp: input.timestamp || now,
      };
    }

    // Normalizing raw Trade object
    const rawTrade = input as Trade;
    const source: TradeSource = sourceOverride || 'PULSE_FEED';
    const type: TradeType = (rawTrade.type || 'buy').toUpperCase() as TradeType;
    const mint = rawTrade.tokenAddress || rawTrade.token || '';
    const symbol = rawTrade.token || mint.slice(0, 6) || 'UNKNOWN';
    const signature = rawTrade.signature || undefined;
    const wallet = rawTrade.fromAccount || undefined;
    const amount = rawTrade.amount || 0;

    const eventId = this.generateEventId(source, type, mint, signature, wallet, now);

    return {
      eventId,
      source,
      type,
      mint,
      symbol,
      wallet,
      amount,
      signature,
      timestamp: now,
      rawTrade,
    };
  }

  private generateEventId(
    source: TradeSource,
    type: TradeType,
    mint: string,
    signature?: string,
    wallet?: string,
    timestamp?: number
  ): string {
    if (signature && signature !== 'no-signature' && signature !== 'synthetic') {
      return `solana:${signature}:${mint}:${type}`;
    }
    const ts = timestamp ? Math.floor(timestamp / 5000) * 5000 : Math.floor(Date.now() / 5000) * 5000;
    return `${source}:${mint}:${type}:${wallet || 'no-wallet'}:${ts}`;
  }

  public clearDeduplicationCache(): void {
    this.processedEventIds.clear();
  }
}

export const unifiedTradePipeline = UnifiedTradePipeline.getInstance();
