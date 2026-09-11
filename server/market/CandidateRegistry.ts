// server/market/CandidateRegistry.ts

export type CandidateState =
  | 'DISCOVERED'
  | 'ENRICHING'
  | 'READY_FOR_EVALUATION'
  | 'EVALUATING'
  | 'BUYING'
  | 'BOUGHT'
  | 'REJECTED'
  | 'EXPIRED';

export interface CandidateRecord {
  mint: string;
  symbol: string;
  network: string;
  state: CandidateState;
  source: string;
  discoveredAt: number;
  updatedAt: number;
  rejectionReason?: string;
  pool?: string;
  protocol?: string;
  score?: number;
}

/**
 * Candidate Registry: Single source of truth for all discovered token candidates.
 * Prevents duplicate processing of the same token.
 */
export class CandidateRegistry {
  private static instance: CandidateRegistry;
  private candidates: Map<string, CandidateRecord> = new Map();
  private readonly MAX_CANDIDATES = 5000;
  private readonly EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

  private constructor() {
    // Periodic cleanup of expired candidates
    const interval = setInterval(() => this.pruneExpired(), 60000);
    if (interval.unref) interval.unref();
  }

  public static getInstance(): CandidateRegistry {
    if (!CandidateRegistry.instance) {
      CandidateRegistry.instance = new CandidateRegistry();
    }
    return CandidateRegistry.instance;
  }

  private getKey(network: string, mint: string): string {
    return `${network}:${mint.trim().toLowerCase()}`;
  }

  /**
   * Register a new candidate. Returns false if already exists.
   */
  public registerCandidate(params: {
    mint: string;
    symbol?: string;
    network: string;
    source: string;
    pool?: string;
    protocol?: string;
  }): boolean {
    const key = this.getKey(params.network, params.mint);

    // Prevent duplicate registration
    if (this.candidates.has(key)) {
      return false;
    }

    // Enforce capacity limit
    if (this.candidates.size >= this.MAX_CANDIDATES) {
      this.evictOldest();
    }

    const record: CandidateRecord = {
      mint: params.mint.trim(),
      symbol: params.symbol || params.mint.slice(0, 6).toUpperCase(),
      network: params.network,
      state: 'DISCOVERED',
      source: params.source,
      discoveredAt: Date.now(),
      updatedAt: Date.now(),
      pool: params.pool,
      protocol: params.protocol,
    };

    this.candidates.set(key, record);
    return true;
  }

  /**
   * Get a candidate by network and mint.
   */
  public getCandidate(network: string, mint: string, pool?: string): CandidateRecord | undefined {
    const key = this.getKey(network, mint);
    return this.candidates.get(key);
  }

  /**
   * Get all candidates.
   */
  public getAllCandidates(): CandidateRecord[] {
    return Array.from(this.candidates.values());
  }

  /**
   * Check if a buy attempt is allowed for a candidate.
   */
  public canAttemptBuy(network: string, wallet: string, mint: string): { allowed: boolean; reason?: string } {
    const candidate = this.getCandidate(network, mint);
    if (!candidate) {
      // Allow buys for tokens not in registry (manual API calls)
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
   * Update candidate state with validation.
   */
  public updateCandidateState(
    network: string,
    mint: string,
    newState: CandidateState,
    metadata?: { rejectionReason?: string; score?: number }
  ): void {
    const key = this.getKey(network, mint);
    const candidate = this.candidates.get(key);
    if (!candidate) return;

    candidate.state = newState;
    candidate.updatedAt = Date.now();
    if (metadata?.rejectionReason) candidate.rejectionReason = metadata.rejectionReason;
    if (metadata?.score !== undefined) candidate.score = metadata.score;
  }

  /**
   * Prune expired candidates.
   */
  private pruneExpired(): void {
    const now = Date.now();
    let pruned = 0;
    for (const [key, candidate] of this.candidates.entries()) {
      if (now - candidate.discoveredAt > this.EXPIRY_MS) {
        this.candidates.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log(`[CandidateRegistry] Pruned ${pruned} expired candidates. Active: ${this.candidates.size}`);
    }
  }

  /**
   * Evict oldest candidate when at capacity.
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, candidate] of this.candidates.entries()) {
      if (candidate.discoveredAt < oldestTime) {
        oldestTime = candidate.discoveredAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.candidates.delete(oldestKey);
    }
  }

  /**
   * Get registry telemetry.
   */
  public getTelemetry() {
    const byState: Record<string, number> = {};
    for (const candidate of this.candidates.values()) {
      byState[candidate.state] = (byState[candidate.state] || 0) + 1;
    }
    return {
      totalCandidates: this.candidates.size,
      maxCapacity: this.MAX_CANDIDATES,
      byState,
    };
  }
}

export const candidateRegistry = CandidateRegistry.getInstance();
