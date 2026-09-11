// server/market/EventNormalizer.ts
import { UnifiedMarketEvent, EventSource } from '../types/index.js';
import { CanonicalEventNormalizer } from './CanonicalEventNormalizer.js';

export interface MarketEvent {
  eventId?: string;
  correlationId?: string;
  chain: 'solana';
  source: EventSource;
  mint: string;
  signature?: string;
  slot?: number;
  timestamp: number;
  type?: string;
  eventType?: string;
  side?: 'buy' | 'sell';
  tokenAmount?: string;
  tokenAmountRaw?: string;
  solAmount?: string;
  solAmountRaw?: string;
  price?: number;
  priceSol?: number;
  buyer?: string;
  seller?: string;
  owner?: string;
  confidence?: number;
  symbol?: string;
  pool?: string;
  protocol?: string;
  network?: string;
  raw?: any;
  accountKeys?: string[];
}

/**
 * Event Normalizer: Converts raw blockchain events to UnifiedMarketEvent format.
 */
export class EventNormalizer {
  private static instance: EventNormalizer;
  private normalizer = CanonicalEventNormalizer.getInstance();

  private constructor() {}

  public static getInstance(): EventNormalizer {
    if (!EventNormalizer.instance) {
      EventNormalizer.instance = new EventNormalizer();
    }
    return EventNormalizer.instance;
  }

  /**
   * Normalize a raw WSS notification into a UnifiedMarketEvent.
   */
  public normalizeWssNotification(msg: any, network: string = 'mainnet'): UnifiedMarketEvent | null {
    if (!msg || !msg.params) return null;

    const { result, subscription } = msg.params;
    if (!result) return null;

    const slot = result.slot || result.context?.slot;
    if (!slot) return null;

    const eventId = this.normalizer.generateEventId('HELIUS_WSS', '', `slot_${slot}`, slot, 'ACCOUNT_UPDATE');
    const correlationId = this.normalizer.generateCorrelationId('HELIUS_WSS', '');

    return {
      eventId,
      correlationId,
      chain: 'solana',
      source: 'HELIUS_WSS',
      mint: '',
      signature: `acc_slot_${slot}`,
      slot,
      timestamp: Date.now(),
      eventType: 'ACCOUNT_UPDATE',
      confidence: 1.0,
      network,
      raw: msg,
    };
  }

  /**
   * Normalize a Helius WSS account update event.
   */
  public normalizeHeliusWssEvent(msg: any, network: string = 'mainnet'): UnifiedMarketEvent | null {
    if (!msg || !msg.params?.result) return null;

    const result = msg.params.result;
    const pubkey = result.value?.pubkey || result.pubkey;
    const owner = result.value?.owner || result.owner;
    const slot = result.context?.slot || result.slot || 0;

    if (!pubkey) return null;

    const eventId = this.normalizer.generateEventId('HELIUS_WSS', pubkey, `acc_${pubkey}`, slot, 'ACCOUNT_UPDATE');
    const correlationId = this.normalizer.generateCorrelationId('HELIUS_WSS', pubkey);

    return {
      eventId,
      correlationId,
      chain: 'solana',
      source: 'HELIUS_WSS',
      mint: pubkey,
      signature: `acc_${pubkey.slice(0, 8)}_${slot}`,
      slot,
      timestamp: Date.now(),
      eventType: 'ACCOUNT_UPDATE',
      confidence: 1.0,
      network,
      raw: msg,
    };
  }

  /**
   * Normalize a trade event from LaserStream gRPC.
   */
  public normalizeLaserStreamTrade(txData: any, network: string = 'mainnet'): UnifiedMarketEvent | null {
    if (!txData) return null;

    const signature = txData.signature || '';
    const slot = txData.slot || 0;
    const mint = txData.mint || '';

    if (!mint) return null;

    const eventId = this.normalizer.generateEventId('LASERSTREAM', mint, signature, slot, 'TRADE');
    const correlationId = this.normalizer.generateCorrelationId('LASERSTREAM', mint);

    return {
      eventId,
      correlationId,
      chain: 'solana',
      source: 'LASERSTREAM',
      mint,
      signature,
      slot,
      timestamp: txData.timestamp || Date.now(),
      eventType: 'TRADE',
      side: txData.side === 'buy' ? 'buy' : txData.side === 'sell' ? 'sell' : undefined,
      tokenAmount: txData.tokenAmount ? String(txData.tokenAmount) : undefined,
      solAmount: txData.solAmount ? String(txData.solAmount) : undefined,
      priceSol: txData.priceSol,
      buyer: txData.buyer,
      seller: txData.seller,
      confidence: 1.0,
      symbol: txData.symbol,
      pool: txData.pool,
      protocol: txData.protocol,
      network,
      raw: txData,
    };
  }

  /**
   * Normalize a manual API event.
   */
  public normalizeManualEvent(body: any): UnifiedMarketEvent | null {
    if (!body || !body.mint) return null;

    const source: EventSource = body.source || 'MANUAL';
    const eventId = body.eventId || this.normalizer.generateManualEventId(body.mint);
    const correlationId = body.correlationId || this.normalizer.generateCorrelationId(source, body.mint);

    return {
      eventId,
      correlationId,
      chain: 'solana',
      source,
      mint: body.mint.trim(),
      signature: body.signature,
      slot: body.slot ? Number(body.slot) : undefined,
      timestamp: body.timestamp || Date.now(),
      eventType: body.eventType || 'TRADE',
      side: body.side,
      tokenAmount: body.tokenAmount ? String(body.tokenAmount) : undefined,
      solAmount: body.solAmount ? String(body.solAmount) : undefined,
      priceSol: body.priceSol ? Number(body.priceSol) : undefined,
      buyer: body.buyer,
      seller: body.seller,
      confidence: body.confidence !== undefined ? Number(body.confidence) : 1.0,
      symbol: body.symbol,
      pool: body.pool,
      protocol: body.protocol,
      network: body.network || 'mainnet',
      raw: body.raw,
    };
  }
}

export const eventNormalizer = EventNormalizer.getInstance();
