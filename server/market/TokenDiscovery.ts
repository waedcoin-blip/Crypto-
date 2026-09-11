// server/market/TokenDiscovery.ts
import { tokenRepository } from '../repositories/TokenRepository.js';
import { candidateRegistry } from './CandidateRegistry.js';
import { marketEventBus } from './MarketEventBus.js';
import { sourceHealthMonitor } from './SourceHealthMonitor.js';
import { UnifiedMarketEvent } from '../types/index.js';

/**
 * Token Discovery: Processes normalized events and registers new candidates.
 */
export class TokenDiscovery {
  private static instance: TokenDiscovery;
  private unsubscribeBus: (() => void) | null = null;
  private isRunning: boolean = false;

  private constructor() {}

  public static getInstance(): TokenDiscovery {
    if (!TokenDiscovery.instance) {
      TokenDiscovery.instance = new TokenDiscovery();
    }
    return TokenDiscovery.instance;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.unsubscribeBus = marketEventBus.subscribe((event: UnifiedMarketEvent) => {
      this.processEvent(event);
    });

    console.log('[TokenDiscovery] Started. Listening for new candidates.');
  }

  public stop(): void {
    this.isRunning = false;
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    console.log('[TokenDiscovery] Stopped.');
  }

  private processEvent(event: UnifiedMarketEvent): void {
    if (!event.mint || !event.source) return;

    // Record event in source health monitor
    sourceHealthMonitor.recordEventReceived(event.source);

    // Skip non-trade events for candidate registration
    if (event.eventType !== 'TRADE' && event.eventType !== 'BUY') return;

    // Register candidate in registry
    const registered = candidateRegistry.registerCandidate({
      mint: event.mint,
      symbol: event.symbol,
      network: event.network || 'mainnet',
      source: event.source,
      pool: event.pool,
      protocol: event.protocol,
    });

    if (registered) {
      sourceHealthMonitor.recordCandidateCreated(event.source);
      console.log(`[TokenDiscovery] NEW CANDIDATE: mint=${event.mint} symbol=${event.symbol} source=${event.source}`);
    }
  }
}

export const tokenDiscovery = TokenDiscovery.getInstance();
