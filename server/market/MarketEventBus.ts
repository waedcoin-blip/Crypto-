// server/market/MarketEventBus.ts
import { MarketEvent } from './EventNormalizer.js';

export type MarketEventListener = (event: MarketEvent) => void;

export class MarketEventBus {
  private static instance: MarketEventBus;
  private listeners: Set<MarketEventListener> = new Set();

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

  public publish(event: MarketEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[MARKET EVENT BUS ERROR]', err);
      }
    }
  }
}

export const marketEventBus = MarketEventBus.getInstance();
