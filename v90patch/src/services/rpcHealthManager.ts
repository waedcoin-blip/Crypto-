// src/services/rpcHealthManager.ts
import { Connection } from '@solana/web3.js';
import { DEFAULT_HELIUS_RPC } from '../constants/solana';
import { telemetryService } from './telemetryService';

export interface RpcHealthStatus {
  url: string;
  latencyMs: number;
  healthy: boolean;
  failCount: number;
  lastChecked: number;
}

export class RpcHealthManager {
  private endpoints = new Map<string, RpcHealthStatus>();
  private activeEndpoint: string = DEFAULT_HELIUS_RPC;
  private secondaryEndpoint: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(status: { primaryUrl: string; secondaryUrl: string | null; latency: number | null }) => void>();

  constructor() {
    this.addEndpoint(DEFAULT_HELIUS_RPC);
    this.startScheduler();
  }

  public addEndpoint(url: string) {
    if (!url || this.endpoints.has(url)) return;
    this.endpoints.set(url, {
      url,
      latencyMs: 999,
      healthy: true,
      failCount: 0,
      lastChecked: 0,
    });
  }

  public setEndpoints(primary: string, secondary?: string) {
    if (primary) {
      this.activeEndpoint = primary;
      this.addEndpoint(primary);
    }
    if (secondary) {
      this.secondaryEndpoint = secondary;
      this.addEndpoint(secondary);
    } else {
      this.secondaryEndpoint = null;
    }
  }

  public getBestEndpoint(): string {
    const healthy = Array.from(this.endpoints.values()).filter((e) => e.healthy);
    if (healthy.length === 0) {
      return this.activeEndpoint || DEFAULT_HELIUS_RPC;
    }
    healthy.sort((a, b) => a.latencyMs - b.latencyMs);
    return healthy[0].url;
  }

  public getActiveEndpoint(): string {
    return this.activeEndpoint;
  }

  public async pingUrl(url: string): Promise<number> {
    const start = performance.now();
    try {
      const conn = new Connection(url, 'confirmed');
      await conn.getSlot('confirmed');
      const ms = Math.round(performance.now() - start);

      const status = this.endpoints.get(url);
      if (status) {
        status.latencyMs = ms;
        status.healthy = true;
        status.failCount = 0;
        status.lastChecked = Date.now();
      }
      telemetryService.recordApiRequest(url, 'getSlot', 200, ms);
      return ms;
    } catch (err: any) {
      const ms = Math.round(performance.now() - start);
      const status = this.endpoints.get(url);
      if (status) {
        status.failCount++;
        status.healthy = status.failCount < 3;
        status.lastChecked = Date.now();
        status.latencyMs = 9999;
      }
      telemetryService.recordApiRequest(url, 'getSlot', 500, ms, err.message || 'RPC Failure');
      return 9999;
    }
  }

  public onChange(fn: (status: { primaryUrl: string; secondaryUrl: string | null; latency: number | null }) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  public async checkHealth() {
    if (!this.activeEndpoint) return;

    const primaryLatency = await this.pingUrl(this.activeEndpoint);
    let currentLatency = primaryLatency < 9999 ? primaryLatency : null;

    // High latency failover check
    const threshold = 400;
    if (primaryLatency > threshold && this.secondaryEndpoint && this.secondaryEndpoint !== this.activeEndpoint) {
      const secondaryLatency = await this.pingUrl(this.secondaryEndpoint);
      if (secondaryLatency < primaryLatency) {
        // Failover switch
        const oldPrimary = this.activeEndpoint;
        this.activeEndpoint = this.secondaryEndpoint;
        this.secondaryEndpoint = oldPrimary;
        currentLatency = secondaryLatency < 9999 ? secondaryLatency : null;
        console.log(`[RpcHealthManager] Failover switch to: ${this.activeEndpoint}`);
      }
    }

    this.listeners.forEach((fn) =>
      fn({
        primaryUrl: this.activeEndpoint,
        secondaryUrl: this.secondaryEndpoint,
        latency: currentLatency,
      })
    );
  }

  private startScheduler() {
    if (this.timer) return;
    this.checkHealth().catch(() => {});
    this.timer = setInterval(() => {
      this.checkHealth().catch(() => {});
    }, 10000); // Consolidated 10s health interval
  }

  public stopScheduler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const rpcHealthManager = new RpcHealthManager();
