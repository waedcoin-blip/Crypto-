// server/market/CanonicalEventNormalizer.ts
import { createHash } from 'crypto';
import { EventSource } from '../types/index.js';

/**
 * Canonical Event Normalizer.
 * Generates deterministic event IDs and correlation IDs for deduplication.
 */
export class CanonicalEventNormalizer {
  private static instance: CanonicalEventNormalizer;

  private constructor() {}

  public static getInstance(): CanonicalEventNormalizer {
    if (!CanonicalEventNormalizer.instance) {
      CanonicalEventNormalizer.instance = new CanonicalEventNormalizer();
    }
    return CanonicalEventNormalizer.instance;
  }

  public static generateCorrelationId(source: EventSource, mint: string): string {
    return CanonicalEventNormalizer.getInstance().generateCorrelationId(source, mint);
  }

  public static generateEventId(
    source: EventSource,
    mint: string,
    signature?: string,
    slot?: number,
    eventType?: string
  ): string {
    return CanonicalEventNormalizer.getInstance().generateEventId(source, mint, signature, slot, eventType);
  }

  /**
   * Generates a deterministic correlation ID for a source+mint pair.
   * Used to correlate all events for the same token from the same source.
   */
  public generateCorrelationId(source: EventSource, mint: string): string {
    const raw = `${source}:${mint.trim()}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  /**
   * Generates a deterministic event ID for deduplication.
   * Combines source, mint, signature, slot, and event type.
   */
  public generateEventId(
    source: EventSource,
    mint: string,
    signature?: string,
    slot?: number,
    eventType?: string
  ): string {
    const parts = [
      source,
      mint.trim(),
      signature || 'no-sig',
      slot?.toString() || 'no-slot',
      eventType || 'TRADE',
    ];
    const raw = parts.join(':');
    return createHash('sha256').update(raw).digest('hex').slice(0, 24);
  }

  /**
   * Validates that an event ID is well-formed.
   */
  public isValidEventId(eventId: string): boolean {
    return typeof eventId === 'string' && eventId.length >= 8 && eventId.length <= 64;
  }

  /**
   * Generates a timestamp-based event ID for manual/API events.
   */
  public generateManualEventId(mint: string): string {
    const raw = `MANUAL:${mint.trim()}:${Date.now()}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 24);
  }
}

export const canonicalEventNormalizer = CanonicalEventNormalizer.getInstance();
