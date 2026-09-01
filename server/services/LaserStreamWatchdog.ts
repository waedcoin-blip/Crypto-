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
export const LASERSTREAM_ACTIVITY_STALE_MS = 60_000;

import type { LaserStreamHealthStatus, LaserStreamTelemetry, LaserStreamMode, LaserStreamNetwork } from '../types/index.js';

export interface WatchdogConfig {
  degradedQueueThreshold: number;
  degradedProcessingLagMs: number;
  degradedSlotLag: number;
  checkIntervalMs: number;
  /** How long lastProcessingDurationMs remains relevant before being treated as stale */
  processingLagStaleMs: number;
  /** How long before lack of server updates marks the connection as stale */
  activityStaleMs: number;
  /** Extended silence threshold after which a degraded transport is treated as dead */
  disconnectAfterStaleMs: number;
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
    activityStaleMs: LASERSTREAM_ACTIVITY_STALE_MS,
    disconnectAfterStaleMs: LASERSTREAM_ACTIVITY_STALE_MS * 3,
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
  private network: LaserStreamNetwork = 'mainnet';
  private mode: LaserStreamMode = 'grpc';
  private activeEndpoint: string | null = null;
  private errorMessage: string | null = null;

  private eventsReceived = 0;
  private eventsProcessed = 0;
  // v98 ingestion diagnostics: distinguish provider silence from local rejection.
  private rawUpdatesReceived = 0;
  private invalidUpdates = 0;
  private rejectedUpdates = 0;
  private duplicateUpdates = 0;
  private queuedUpdates = 0;
  private processingFailures = 0;
  private reconnectCount = 0;

  private status: LaserStreamHealthStatus = 'disabled';
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  private reconnectHandler: ReconnectHandler | null = null;
  private healthCheckHandler: HealthCheckHandler | null = null;
  private stateChangeListeners: Set<StateChangeHandler> = new Set();

  private isReconnecting = false;
  private lastStaleWarningAt = 0;

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

  public recordRawUpdate(): void { this.rawUpdatesReceived++; }
  public recordInvalidUpdate(): void { this.invalidUpdates++; }
  public recordRejectedUpdate(): void { this.rejectedUpdates++; }
  public recordDuplicateUpdate(): void { this.duplicateUpdates++; }
  public recordQueuedUpdate(): void { this.queuedUpdates++; }
  public recordProcessingFailure(): void { this.processingFailures++; }

  public recordReceivedEvent(slot: number): void {
    const now = Date.now();
    this.lastEventAt = now;
    if (slot > this.lastReceivedSlot) {
      this.lastReceivedSlot = slot;
    }
    this.eventsReceived++;

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

    // Guard against false-positive when slots are still 0 at startup
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
    mode: LaserStreamMode = 'grpc',
    network: LaserStreamNetwork = 'mainnet'
  ): void {
    this.transportConnected = connected;
    this.activeEndpoint = endpoint;
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

  public setDisconnected(): void {
    // Do not pre-set status here. evaluateHealth() must observe the transition so
    // state listeners and the reconnect handler are invoked exactly once.
    this.transportConnected = false;
    this.connectedAt = 0;
    this.evaluateHealth();
  }

  public setDisabled(errorMessage: string | null = null): void {
    if (errorMessage) this.errorMessage = errorMessage;
    // Keep the current status until evaluateHealth() performs the transition.
    this.transportConnected = false;
    this.connectedAt = 0;
    this.isReconnecting = false;
    const previousStatus = this.status;
    this.status = 'disabled';
    if (previousStatus !== 'disabled') {
      const telemetry = this.getMetrics();
      this.stateChangeListeners.forEach((listener) => {
        try { listener('disabled', telemetry); } catch (e) {
          laserLogger.error({ error: e }, 'Error in watchdog state listener');
        }
      });
    }
  }

  public setReplaying(replaying: boolean, fromSlot: number | null = null): void {
    this.isReplaying = replaying;
    this.replayFromSlot = fromSlot;
    this.evaluateHealth();
  }

  public recordError(errorMessage: string | null): void {
    this.errorMessage = errorMessage;
    if (errorMessage) {
      const lower = errorMessage.toLowerCase();
      if (
        lower.includes('unsupported plan') ||
        lower.includes('business or professional plan') ||
        lower.includes('invalid helius api key') ||
        lower.includes('does not have permission') ||
        lower.includes('permission denied') ||
        lower.includes('geyser access denied')
      ) {
        this.status = 'disabled';
        this.transportConnected = false;
        this.isReconnecting = false;
      } else if (this.status === 'connected') {
        this.evaluateHealth();
      }
    }
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
    const slotLag = this.lastReceivedSlot > 0 && this.lastProcessedSlot > 0 ? Math.max(0, this.lastReceivedSlot - this.lastProcessedSlot) : 0;
    const now = Date.now();

    const isProcessingLagStale =
      this.lastProcessedAt === 0 ||
      now - this.lastProcessedAt > this.config.processingLagStaleMs;
    const processingLagMs = isProcessingLagStale ? 0 : this.lastProcessingDurationMs;

    const ingestionState: 'active' | 'idle' | 'replaying' = this.isReplaying
      ? 'replaying'
      : this.lastEventAt > 0 && now - this.lastEventAt <= this.config.activityStaleMs
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
      rawUpdatesReceived: this.rawUpdatesReceived,
      invalidUpdates: this.invalidUpdates,
      rejectedUpdates: this.rejectedUpdates,
      duplicateUpdates: this.duplicateUpdates,
      queuedUpdates: this.queuedUpdates,
      processingFailures: this.processingFailures,
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

    const metrics = this.getMetrics();
    const slotLag = metrics.slotLag;
    const processingLagMs = metrics.processingLagMs;

    const now = Date.now();
    const lastActivity = Math.max(this.lastEventAt, this.lastHeartbeatAt, this.connectedAt);
    const activityAgeMs = lastActivity > 0 ? now - lastActivity : 0;
    const isStale =
      this.transportConnected &&
      lastActivity > 0 &&
      activityAgeMs > this.config.activityStaleMs;
    const isExtendedStale =
      this.transportConnected &&
      lastActivity > 0 &&
      activityAgeMs > this.config.disconnectAfterStaleMs;

    if (isStale && now - this.lastStaleWarningAt >= this.config.activityStaleMs) {
      this.lastStaleWarningAt = now;
      laserLogger.warn(
        { activityAgeMs, disconnectAfterStaleMs: this.config.disconnectAfterStaleMs },
        'LaserStream activity stale; marking degraded while awaiting recovery'
      );
    }

    if (isExtendedStale) {
      // A short quiet period can be caused by subscription filters, but prolonged
      // silence is a recovery condition. Force a real disconnect so the normal
      // transition/reconnect path is used rather than remaining degraded forever.
      this.transportConnected = false;
      this.connectedAt = 0;
    }

    let newStatus: LaserStreamHealthStatus;

    if (!this.transportConnected) {
      // If we are explicitly connecting and haven't failed, stay connecting
      newStatus = this.status === 'connecting' ? 'connecting' : 'disconnected';
    } else if (this.isReplaying) {
      newStatus = 'replaying';
    } else if (
      isStale ||
      this.queueDepth >= this.config.degradedQueueThreshold ||
      processingLagMs >= this.config.degradedProcessingLagMs ||
      slotLag >= this.config.degradedSlotLag
    ) {
      newStatus = 'degraded';
    } else {
      newStatus = 'connected';
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

      // FIX: Trigger reconnect handler when we become disconnected (unless fatal plan/auth error)
      if (newStatus === 'disconnected' && this.reconnectHandler && !this.isReconnecting) {
        const lowerErr = (this.errorMessage || '').toLowerCase();
        const isUnrecoverable =
          lowerErr.includes('unsupported plan') ||
          lowerErr.includes('business or professional plan') ||
          lowerErr.includes('invalid helius api key') ||
          lowerErr.includes('does not have permission') ||
          lowerErr.includes('permission denied') ||
          lowerErr.includes('geyser access denied');

        if (isUnrecoverable) {
          this.status = 'disabled';
          this.isReconnecting = false;
        } else {
          this.isReconnecting = true;
          const fromSlot = this.lastProcessedSlot;
          Promise.resolve(this.reconnectHandler(fromSlot))
            .then(() => {
              if (!this.transportConnected) {
                // Failed to reconnect, reset after a delay to prevent tight loops
                setTimeout(() => {
                  this.isReconnecting = false;
                }, 5000);
              }
            })
            .catch((err) => {
              laserLogger.error({ error: err, fromSlot }, 'Reconnect handler failed');
              setTimeout(() => {
                this.isReconnecting = false;
              }, 5000);
            });
        }
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
    this.rawUpdatesReceived = 0;
    this.invalidUpdates = 0;
    this.rejectedUpdates = 0;
    this.duplicateUpdates = 0;
    this.queuedUpdates = 0;
    this.processingFailures = 0;
    this.reconnectCount = 0;
    this.transportConnected = false;
    this.isReconnecting = false;
    this.lastStaleWarningAt = 0;
    this.errorMessage = null;
    this.status = disabled ? 'disabled' : 'connecting';
  }
}

export const laserStreamWatchdog = new LaserStreamWatchdog();
