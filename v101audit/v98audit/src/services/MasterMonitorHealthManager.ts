// src/services/MasterMonitorHealthManager.ts
import { Connection } from '@solana/web3.js';
import { telemetryService } from './telemetryService';

export interface MasterMonitorStatus {
  primaryUrl: string;
  backupUrl: string | null;
  wsUrl: string | null;
  activeUrl: string;
  status: 'PRIMARY' | 'BACKUP' | 'STALE' | 'OFFLINE' | 'CONNECTING' | 'LIVE' | 'DEGRADED';
  latencyMs: number | null;
  slot: number | null;
  lastUpdated: number | null; // Timestamp
  isSharedMode: boolean;
}

export class MasterMonitorHealthManager {
  private primaryUrl: string = '';
  private backupUrl: string | null = null;
  private wsUrl: string | null = null;
  private activeUrl: string = '';
  
  private currentStatus: 'PRIMARY' | 'BACKUP' | 'STALE' | 'OFFLINE' | 'CONNECTING' | 'LIVE' | 'DEGRADED' = 'OFFLINE';
  private latencyMs: number | null = null;
  private slot: number | null = null;
  private lastUpdated: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private listeners = new Set<(status: MasterMonitorStatus) => void>();

  constructor() {
    this.loadFromStorage();
    this.startScheduler();
  }

  public loadFromStorage() {
    const storedPrimary = localStorage.getItem('master_monitor_rpc') || '';
    const storedBackup = localStorage.getItem('master_monitor_rpc2') || '';
    const storedWs = localStorage.getItem('master_monitor_ws') || '';

    this.primaryUrl = storedPrimary.trim();
    this.backupUrl = storedBackup.trim() ? storedBackup.trim() : null;
    this.wsUrl = storedWs.trim() ? storedWs.trim() : null;

    if (this.primaryUrl) {
      this.activeUrl = this.primaryUrl;
      this.currentStatus = 'CONNECTING';
    } else {
      this.activeUrl = '';
      this.currentStatus = 'OFFLINE';
    }
  }

  public setEndpoints(primary: string, backup?: string, ws?: string) {
    this.primaryUrl = (primary || '').trim();
    this.backupUrl = backup && backup.trim() ? backup.trim() : null;
    this.wsUrl = ws && ws.trim() ? ws.trim() : null;

    if (this.primaryUrl) {
      localStorage.setItem('master_monitor_rpc', this.primaryUrl);
    } else {
      localStorage.removeItem('master_monitor_rpc');
    }

    if (this.backupUrl) {
      localStorage.setItem('master_monitor_rpc2', this.backupUrl);
    } else {
      localStorage.removeItem('master_monitor_rpc2');
    }

    if (this.wsUrl) {
      localStorage.setItem('master_monitor_ws', this.wsUrl);
    } else {
      localStorage.removeItem('master_monitor_ws');
    }

    if (this.primaryUrl) {
      this.activeUrl = this.primaryUrl;
      this.currentStatus = 'CONNECTING';
    } else {
      this.activeUrl = '';
      this.currentStatus = 'OFFLINE';
    }

    this.checkHealth().catch(() => {});
  }

  public getStatus(): MasterMonitorStatus {
    return {
      primaryUrl: this.primaryUrl,
      backupUrl: this.backupUrl,
      wsUrl: this.wsUrl,
      activeUrl: this.activeUrl,
      status: this.currentStatus,
      latencyMs: this.latencyMs,
      slot: this.slot,
      lastUpdated: this.lastUpdated,
      isSharedMode: false,
    };
  }

  public getActiveEndpoint(): string {
    return this.activeUrl;
  }

  public getActiveWsEndpoint(): string | null {
    if (this.wsUrl) return this.wsUrl;
    if (!this.activeUrl) return null;
    return this.activeUrl.replace('https://', 'wss://').replace('http://', 'ws://');
  }

  public onChange(fn: (status: MasterMonitorStatus) => void) {
    this.listeners.add(fn);
    // Emit initial status
    fn(this.getStatus());
    return () => {
      this.listeners.delete(fn);
    };
  }

  public async testConnection(): Promise<MasterMonitorStatus> {
    await this.checkHealth();
    return this.getStatus();
  }

  private lastObservedSlot: number = 0;
  private lastObservedAt: number = 0;

  public async checkHealth(): Promise<void> {
    const targetUrl = this.activeUrl;
    if (!targetUrl || !this.primaryUrl) {
      this.currentStatus = 'OFFLINE';
      this.latencyMs = null;
      this.notifyListeners();
      return;
    }

    const start = performance.now();

    try {
      const conn = new Connection(targetUrl, 'confirmed');
      const currentSlot = await conn.getSlot('confirmed');
      const duration = Math.round(performance.now() - start);

      const slotLag = this.lastObservedSlot > 0 ? Math.max(0, this.lastObservedSlot - currentSlot) : 0;
      if (currentSlot >= this.lastObservedSlot) {
        this.lastObservedSlot = currentSlot;
        this.lastObservedAt = Date.now();
      }

      this.latencyMs = duration;
      this.slot = currentSlot;
      this.lastUpdated = Date.now();
      
      if (slotLag > 3) {
        this.currentStatus = 'STALE';
      } else if (duration > 800) {
        this.currentStatus = 'DEGRADED';
      } else if (targetUrl === this.backupUrl) {
        this.currentStatus = 'BACKUP';
      } else {
        this.currentStatus = 'PRIMARY';
      }

      telemetryService.recordApiRequest(targetUrl, 'getSlot', 200, duration);
    } catch (err: any) {
      const duration = Math.round(performance.now() - start);
      console.warn(`[MasterMonitorHealthManager] Check failed on ${targetUrl}:`, err.message || err);
      
      // Failover only to master_monitor_rpc2 (backupUrl), NEVER to execution RPC
      if (this.backupUrl && this.activeUrl === this.primaryUrl) {
        console.log(`[MasterMonitorHealthManager] Switching to backup Master RPC: ${this.backupUrl}`);
        this.activeUrl = this.backupUrl;
        this.currentStatus = 'BACKUP';
        
        try {
          const connBackup = new Connection(this.backupUrl, 'confirmed');
          const backupSlot = await connBackup.getSlot('confirmed');
          const backupDuration = Math.round(performance.now() - start);

          this.latencyMs = backupDuration;
          this.slot = backupSlot;
          this.lastUpdated = Date.now();
          this.currentStatus = 'BACKUP';
        } catch {
          this.currentStatus = 'OFFLINE';
          this.latencyMs = null;
        }
      } else {
        this.currentStatus = 'OFFLINE';
        this.latencyMs = null;
      }

      telemetryService.recordApiRequest(targetUrl, 'getSlot', 500, duration, err.message || 'Master Monitor Failure');
    }

    this.notifyListeners();
  }


  private notifyListeners() {
    const status = this.getStatus();
    this.listeners.forEach((fn) => fn(status));
  }

  private startScheduler() {
    if (this.timer) return;
    this.checkHealth().catch(() => {});
    this.timer = setInterval(() => {
      this.checkHealth().catch(() => {});
    }, 8000);
  }

  public stopScheduler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const masterMonitorHealthManager = new MasterMonitorHealthManager();
