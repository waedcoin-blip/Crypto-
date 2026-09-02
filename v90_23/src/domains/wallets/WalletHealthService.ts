export type WalletHealthStatus = 'SYNCED' | 'SYNCING' | 'STALE' | 'DISCONNECTED' | 'ERROR' | 'NO_ACTIVITY';

export interface WalletHealthRecord {
  walletAddress: string;
  status: WalletHealthStatus;
  lastTxTimestamp: number | null;
  activeSubscriptionsCount: number;
  errorMessage?: string;
  updatedAt: number;
}

export class WalletHealthService {
  private healthMap: Map<string, WalletHealthRecord> = new Map();
  private listeners: Set<(records: WalletHealthRecord[]) => void> = new Set();

  public updateStatus(walletAddress: string, status: WalletHealthStatus, errorMessage?: string): void {
    const existing = this.healthMap.get(walletAddress) || {
      walletAddress,
      status: 'DISCONNECTED',
      lastTxTimestamp: null,
      activeSubscriptionsCount: 0,
      updatedAt: Date.now(),
    };

    existing.status = status;
    if (errorMessage) existing.errorMessage = errorMessage;
    existing.updatedAt = Date.now();
    this.healthMap.set(walletAddress, existing);
    this.notify();
  }

  public recordTransaction(walletAddress: string, timestamp: number): void {
    const existing = this.healthMap.get(walletAddress) || {
      walletAddress,
      status: 'SYNCED',
      lastTxTimestamp: timestamp,
      activeSubscriptionsCount: 1,
      updatedAt: Date.now(),
    };
    existing.lastTxTimestamp = timestamp;
    existing.status = 'SYNCED';
    existing.updatedAt = Date.now();
    this.healthMap.set(walletAddress, existing);
    this.notify();
  }

  public setSubscriptionCount(walletAddress: string, count: number): void {
    const existing = this.healthMap.get(walletAddress) || {
      walletAddress,
      status: count > 0 ? 'SYNCED' : 'DISCONNECTED',
      lastTxTimestamp: null,
      activeSubscriptionsCount: count,
      updatedAt: Date.now(),
    };
    existing.activeSubscriptionsCount = count;
    existing.status = count > 0 ? 'SYNCED' : 'DISCONNECTED';
    existing.updatedAt = Date.now();
    this.healthMap.set(walletAddress, existing);
    this.notify();
  }

  public getHealth(walletAddress: string): WalletHealthRecord | undefined {
    return this.healthMap.get(walletAddress);
  }

  public getAllHealth(): WalletHealthRecord[] {
    return Array.from(this.healthMap.values());
  }

  public subscribe(fn: (records: WalletHealthRecord[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.getAllHealth());
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const records = this.getAllHealth();
    this.listeners.forEach(fn => fn(records));
  }
}

export const walletHealthService = new WalletHealthService();
