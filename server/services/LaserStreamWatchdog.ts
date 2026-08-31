/**
 * Helius LaserStream Watchdog & Slot-Based Health Engine
 *
 * Provides:
 * 1. Slot-based freshness checks (lastReceivedSlot, lastProcessedSlot, slotLag)
 * 2. Accurate processing duration tracking (lastProcessingDurationMs)
 * 3. Separation of Transport vs Ingestion (Idle/Active) vs Processing vs Telemetry
 * 4. Queue backpressure monitoring and replay coordination
 */

import { laserLogger } from '../utils/logger.js';
import type { LaserStreamHealthStatus, LaserStreamTelemetry, LaserStreamMode, LaserStreamNetwork } from '../types/index.js';

export interface WatchdogConfig {
  degradedQueueThreshold: number;
  degradedProcessingLagMs: number;
  degradedSlotLag: number;
  checkIntervalMs: number;
  /** How long lastProcessingDurationMs remains relevant before being treated as stale */
  processingLagStaleMs: number;
}

export type ReconnectHandler = (fromSlot: number) => Promise<void> | void;
export type HealthCheckHandler = () => Promise<void> | void;
export type StateChangeHandler = (status: LaserStreamHealthStatus, metrics: LaserStreamTelemetry) => void;

class LaserStreamWatchdog {
  private config: WatchdogConfig = {
    degradedQueueThreshold: 50,
    degradedProcessingLagMs: 1500,
    degradedSlotLag: 15,
    checkIntervalMs: 1000,
    processingLagStaleMs: 30000,
  };

  private lastReceivedSlot = 0;
  private lastProcessedSlot = 0;
  private lastEventAt = 0;
  private lastHeartbeatAt = 0;
  private lastProcessedAt = 0;
  private lastProcessingDurationMs = 0;
  private connectedAt = 0;
  private queueDepth = 0;
  private isReplaying = false;
  private replayFromSlot: number | null = null;

  private transportConnected = false;
  private isFallback = false;
  private isSimulated = false;
  private network: LaserStreamNetwork = 'mainnet';
  private mode: LaserStreamMode = 'grpc';
  private activeEndpoint: string | null = null;
  private errorMessage: string | null = null;

  private eventsReceived = 0;
  private eventsProcessed = 0;
  private reconnectCount = 0;

  private status: LaserStreamHealthStatus = 'disabled';
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  private reconnectHandler: ReconnectHandler | null = null;
  private healthCheckHandler: HealthCheckHandler | null = null;
  private stateChangeListeners: Set<StateChangeHandler> = new Set();

  private isReconnecting = false;

  constructor() {
    this.start();
  }

  public setReconnectHandler(handler: ReconnectHandler): void {
    this.reconnectHandler = handler;
  }

  public setHealthCheckHandler(handler: HealthCheckHandler): void {
    this.healthCheckHandler = handler;
  }

  public onStateChange(listener: StateChangeHandler): () => void {
    this.stateChangeListeners.add(listener);
    return () => this.stateChangeListeners.delete(listener);
  }

  public recordReceivedEvent(slot: number): void {
    const now = Date.now();
    this.lastEventAt = now;
    if (slot > this.lastReceivedSlot) {
      this.lastReceivedSlot = slot;
    }
    this.eventsReceived++;

    // If replaying and caught up to tip, mark replay complete
    if (
      this.isReplaying &&
      this.lastProcessedSlot > 0 &&
      this.lastReceivedSlot - this.lastProcessedSlot <= 2
    ) {
      this.isReplaying = false;
      this.replayFromSlot = null;
      laserLogger.info(
        { slot: this.lastProcessedSlot },
        'LaserStream historical replay caught up with live chain tip (receive-side)'
      );
    }
  }

  public recordProcessedEvent(slot: number, processingTimeMs?: number): void {
    const now = Date.now();
    this.lastProcessedAt = now;
    if (slot > this.lastProcessedSlot) {
      this.lastProcessedSlot = slot;
    }
    this.eventsProcessed++;

    if (typeof processingTimeMs === 'number') {
      this.lastProcessingDurationMs = Math.max(0, processingTimeMs);
    }

    // FIX: Guard against false-positive when slots are still 0 at startup
    if (
      this.isReplaying &&
      this.lastProcessedSlot > 0 &&
      this.lastReceivedSlot - this.lastProcessedSlot <= 2
    ) {
      this.isReplaying = false;
      this.replayFromSlot = null;
      laserLogger.info(
        { slot: this.lastProcessedSlot },
        'LaserStream historical replay caught up with live chain tip (process-side)'
      );
    }
  }

  public recordHeartbeat(): void {
    this.lastHeartbeatAt = Date.now();
  }

  public setQueueDepth(depth: number): void {
    this.queueDepth = Math.max(0, depth);
  }

  public setTransportState(
    connected: boolean,
    endpoint: string | null = null,
    isFallback = false,
    isSimulated = false,
    mode: LaserStreamMode = 'grpc',
    network: LaserStreamNetwork = 'mainnet'
  ): void {
    this.transportConnected = connected;
    this.activeEndpoint = endpoint;
    this.isFallback = isFallback;
    this.isSimulated = isSimulated;
    this.mode = mode;
    this.network = network;

    if (connected) {
      this.isReconnecting = false;
      if (this.connectedAt === 0) {
        this.connectedAt = Date.now();
      }
    } else {
      this.connectedAt = 0;
    }
    this.evaluateHealth();
  }

  public setReplaying(replaying: boolean, fromSlot: number | null = null): void {
    this.isReplaying = replaying;
    this.replayFromSlot = fromSlot;
    this.evaluateHealth();
  }

  public recordError(errorMessage: string | null): void {
    this.errorMessage = errorMessage;
  }

  public recordReconnect(): void {
    this.reconnectCount++;
  }

  public getLastProcessedSlot(): number {
    return this.lastProcessedSlot;
  }

  public getLastReceivedSlot(): number {
    return this.lastReceivedSlot;
  }

  public getMetrics(): LaserStreamTelemetry {
    const slotLag = Math.max(0, this.lastReceivedSlot - this.lastProcessedSlot);
    const now = Date.now();

    // FIX: Treat processingLagMs as stale if we haven't processed recently
    const isProcessingLagStale =
      this.lastProcessedAt === 0 ||
      now - this.lastProcessedAt > this.config.processingLagStaleMs;
    const processingLagMs = isProcessingLagStale ? 0 : this.lastProcessingDurationMs;

    const ingestionState: 'active' | 'idle' | 'replaying' = this.isReplaying
      ? 'replaying'
      : this.lastEventAt > 0 && now - this.lastEventAt <= 10_000
        ? 'active'
        : 'idle';

    return {
      transportConnected: this.transportConnected,
      connectedAt: this.connectedAt || null,
      status: this.status,
      ingestionState,
      lastHeartbeatAt: this.lastHeartbeatAt || null,
      lastEventAt: this.lastEventAt || null,
      lastReceivedSlot: this.lastReceivedSlot,
      lastProcessedSlot: this.lastProcessedSlot,
      slotLag,
      processingLagMs,
      queueDepth: this.queueDepth,
      isReplaying: this.isReplaying,
      replayFromSlot: this.replayFromSlot,
      eventsReceived: this.eventsReceived,
      eventsProcessed: this.eventsProcessed,
      reconnectCount: this.reconnectCount,
      network: this.network,
      endpoint: this.activeEndpoint,
      mode: this.mode,
      errorMessage: this.errorMessage,
    };
  }

  public evaluateHealth(): LaserStreamHealthStatus {
    const previousStatus = this.status;

    if (!this.transportConnected && this.status === 'disabled') {
      return 'disabled';
    }

    const metrics = this.getMetrics(); // uses stale-safe processingLagMs
    const slotLag = metrics.slotLag;
    const processingLagMs = metrics.processingLagMs;

    let newStatus: LaserStreamHealthStatus;

    if (!this.transportConnected) {
      newStatus = 'disconnected';
    } else if (this.isReplaying) {
      newStatus = 'replaying';
    } else if (
      this.queueDepth >= this.config.degradedQueueThreshold ||
      processingLagMs >= this.config.degradedProcessingLagMs ||
      slotLag >= this.config.degradedSlotLag
    ) {
      newStatus = 'degraded';
    } else {
      newStatus = this.isSimulated
        ? 'simulated'
        : this.isFallback
          ? 'fallback'
          : 'connected';
    }

    if (newStatus !== previousStatus) {
      this.status = newStatus;
      const telemetry = this.getMetrics();
      this.stateChangeListeners.forEach((listener) => {
        try {
          listener(newStatus, telemetry);
        } catch (e) {
          laserLogger.error({ error: e }, 'Error in watchdog state listener');
        }
      });

      // FIX: Trigger reconnect handler when we become disconnected
      if (newStatus === 'disconnected' && this.reconnectHandler && !this.isReconnecting) {
        this.isReconnecting = true;
        const fromSlot = this.lastProcessedSlot;
        Promise.resolve(this.reconnectHandler(fromSlot)).catch((err) => {
          laserLogger.error({ error: err, fromSlot }, 'Reconnect handler failed');
          this.isReconnecting = false;
        });
      }
    }

    return this.status;
  }

  public start(): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => {
      this.evaluateHealth();

      // FIX: Actually invoke the health check handler on every tick
      if (this.healthCheckHandler) {
        Promise.resolve(this.healthCheckHandler()).catch((err) => {
          laserLogger.error({ error: err }, 'Health check handler failed');
        });
      }
    }, this.config.checkIntervalMs);
  }

  public stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  public reset(disabled = true): void {
    this.lastReceivedSlot = 0;
    this.lastProcessedSlot = 0;
    this.lastEventAt = 0;
    this.lastHeartbeatAt = 0;
    this.lastProcessedAt = 0;
    this.lastProcessingDurationMs = 0;
    this.connectedAt = 0;
    this.queueDepth = 0;
    this.isReplaying = false;
    this.replayFromSlot = null;
    this.eventsReceived = 0;
    this.eventsProcessed = 0;
    this.reconnectCount = 0;
    this.transportConnected = false;
    this.isReconnecting = false;
    this.errorMessage = null;
    this.status = disabled ? 'disabled' : 'connecting';
  }
}

export const laserStreamWatchdog = new LaserStreamWatchdog();
