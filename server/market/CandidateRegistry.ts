// server/market/CandidateRegistry.ts
import {
  EventSource,
  CandidateLifecycleState,
  CandidatePipelineRecord,
  UnifiedMarketEvent,
} from '../types/index.js';
import { sourceHealthMonitor } from './SourceHealthMonitor.js';

export class CandidateRegistry {
  private static instance: CandidateRegistry;

  // Key: `${network}:${mint}`
  private candidates: Map<string, CandidatePipelineRecord> = new Map();
  // Key: eventId (deduplication cache)
  private processedEventIds: Set<string> = new Set();
  private readonly MAX_EVENT_CACHE = 50000;
  private readonly CANDIDATE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

  private constructor() {
    // Periodic cleanup of stale candidate records
    setInterval(() => {
      this.cleanupStaleCandidates();
    }, 60000);
  }

  public static getInstance(): CandidateRegistry {
    if (!CandidateRegistry.instance) {
      CandidateRegistry.instance = new CandidateRegistry();
    }
    return CandidateRegistry.instance;
  }

  /**
   * Checks if an event is duplicate by eventId.
   */
  public isEventDuplicate(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }

  /**
   * Registers event as processed.
   */
  public markEventProcessed(eventId: string): void {
    this.processedEventIds.add(eventId);
    if (this.processedEventIds.size > this.MAX_EVENT_CACHE) {
      const arr = Array.from(this.processedEventIds);
      this.processedEventIds = new Set(arr.slice(arr.length - 25000));
    }
  }

  /**
   * Ingests or updates a candidate token from any discovery source.
   * Merges sources and preserves the authoritative state.
   */
  public registerOrUpdateCandidate(
    event: UnifiedMarketEvent,
    network: string = 'mainnet'
  ): { candidate: CandidatePipelineRecord; isNewCandidate: boolean } {
    const key = `${network}:${event.mint}`;
    const now = Date.now();
    let isNewCandidate = false;

    let candidate = this.candidates.get(key);

    if (!candidate) {
      isNewCandidate = true;
      candidate = {
        mint: event.mint,
        network,
        symbol: event.symbol || event.mint.slice(0, 6).toUpperCase(),
        firstDiscoveredSource: event.source,
        sources: [event.source],
        firstDiscoveredAt: now,
        lastEventAt: now,
        state: 'DISCOVERED',
        correlationId: event.correlationId || `corr_${event.source.toLowerCase()}_${event.mint.slice(0, 8)}_${now}`,
      };
      this.candidates.set(key, candidate);
      sourceHealthMonitor.recordCandidate(event.source);
    } else {
      candidate.lastEventAt = now;
      if (!candidate.sources.includes(event.source)) {
        candidate.sources.push(event.source);
      }
      if (event.symbol && (!candidate.symbol || candidate.symbol.startsWith('0x') || candidate.symbol.length > 10)) {
        candidate.symbol = event.symbol;
      }
    }

    return { candidate, isNewCandidate };
  }

  /**
   * Check if a candidate can attempt a BUY.
   * Rejects if already BUYING, BOUGHT, or actively locked.
   */
  public canAttemptBuy(network: string, mint: string): { allowed: boolean; reason?: string } {
    const key = `${network}:${mint}`;
    const candidate = this.candidates.get(key);

    if (!candidate) {
      return { allowed: true };
    }

    if (candidate.state === 'BUYING') {
      return { allowed: false, reason: 'BUY_IN_PROGRESS: Token is currently undergoing buy transaction' };
    }

    if (candidate.state === 'BOUGHT') {
      return { allowed: false, reason: 'ALREADY_BOUGHT: Token was already purchased' };
    }

    return { allowed: true };
  }

  /**
   * Transitions candidate state with validation.
   */
  public updateCandidateState(
    network: string,
    mint: string,
    state: CandidateLifecycleState,
    details?: {
      score?: number;
      rejectionReason?: string;
      orderId?: string;
      signature?: string;
      positionId?: string;
    }
  ): void {
    const key = `${network}:${mint}`;
    const candidate = this.candidates.get(key);
    if (!candidate) return;

    candidate.state = state;
    candidate.lastEventAt = Date.now();

    if (details?.score !== undefined) candidate.score = details.score;
    if (details?.rejectionReason) candidate.rejectionReason = details.rejectionReason;
    if (details?.orderId) candidate.buyOrderId = details.orderId;
    if (details?.signature) candidate.buySignature = details.signature;
    if (details?.positionId) candidate.positionId = details.positionId;
  }

  public getCandidate(network: string, mint: string): CandidatePipelineRecord | undefined {
    return this.candidates.get(`${network}:${mint}`);
  }

  public getAllCandidates(network?: string): CandidatePipelineRecord[] {
    const list = Array.from(this.candidates.values());
    if (network) {
      return list.filter((c) => c.network === network);
    }
    return list;
  }

  private cleanupStaleCandidates(): void {
    const now = Date.now();
    for (const [key, candidate] of this.candidates.entries()) {
      if (now - candidate.lastEventAt > this.CANDIDATE_TTL_MS && candidate.state !== 'BUYING') {
        this.candidates.delete(key);
      }
    }
  }
}

export const candidateRegistry = CandidateRegistry.getInstance();
