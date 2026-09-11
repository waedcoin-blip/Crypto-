// server/market/SourceHealthMonitor.ts

export interface SourceStats {
  source: string;
  eventsReceived: number;
  eventsNormalized: number;
  candidatesCreated: number;
  buyConfirmed: number;
  buyFailed: number;
  lastEventAt: number;
  avgLatencyMs: number;
}

/**
 * Source Health Monitor: Tracks the health and throughput of all event sources.
 */
export class SourceHealthMonitor {
  private static instance: SourceHealthMonitor;
  private stats: Map<string, SourceStats> = new Map();
  private readonly STALE_THRESHOLD_MS = 120000; // 2 minutes without events = stale

  private constructor() {}

  public static getInstance(): SourceHealthMonitor {
    if (!SourceHealthMonitor.instance) {
      SourceHealthMonitor.instance = new SourceHealthMonitor();
    }
    return SourceHealthMonitor.instance;
  }

  public recordEventReceived(source: string): void {
    const stats = this.getOrCreateStats(source);
    stats.eventsReceived++;
    stats.lastEventAt = Date.now();
  }

  public recordEventNormalized(source: string): void {
    const stats = this.getOrCreateStats(source);
    stats.eventsNormalized++;
  }

  public recordCandidateCreated(source: string): void {
    const stats = this.getOrCreateStats(source);
    stats.candidatesCreated++;
  }

  public recordBuyConfirmed(source: string): void {
    const stats = this.getOrCreateStats(source);
    stats.buyConfirmed++;
  }

  public recordBuyFailed(source: string): void {
    const stats = this.getOrCreateStats(source);
    stats.buyFailed++;
  }

  private getOrCreateStats(source: string): SourceStats {
    let stats = this.stats.get(source);
    if (!stats) {
      stats = {
        source,
        eventsReceived: 0,
        eventsNormalized: 0,
        candidatesCreated: 0,
        buyConfirmed: 0,
        buyFailed: 0,
        lastEventAt: Date.now(),
        avgLatencyMs: 0,
      };
      this.stats.set(source, stats);
    }
    return stats;
  }

  public getSnapshot(): Record<string, SourceStats & { isStale: boolean; health: 'healthy' | 'degraded' | 'stale' }> {
    const now = Date.now();
    const snapshot: Record<string, any> = {};
    for (const [source, stats] of this.stats.entries()) {
      const age = now - stats.lastEventAt;
      const isStale = age > this.STALE_THRESHOLD_MS;
      const health = isStale ? 'stale' : (stats.eventsReceived > 0 ? 'healthy' : 'degraded');
      snapshot[source] = { ...stats, isStale, health };
    }
    return snapshot;
  }

  public getSourceHealth(source: string): 'healthy' | 'degraded' | 'stale' {
    const stats = this.stats.get(source);
    if (!stats) return 'degraded';
    const age = Date.now() - stats.lastEventAt;
    if (age > this.STALE_THRESHOLD_MS) return 'stale';
    return 'healthy';
  }
}

export const sourceHealthMonitor = SourceHealthMonitor.getInstance();
