// server/market/StreamingTransportManager.ts
import { laserStreamPipeline } from './LaserStreamPipeline.js';
import { heliusLaserStreamWssManager } from './HeliusLaserStreamWssManager.js';

export type TransportState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'FAILED' | 'DEGRADED';

export interface StreamingTransportTelemetry {
  transport: 'grpc' | 'wss';
  state: TransportState;
  connectedAt: number | null;
  lastMessageAt: number | null;
  messagesReceived: number;
  messagesPerSecond: number;
  lastSlot: number;
  activeEndpoint: string | null;
  reconnectAttempts: number;
}

/**
 * Streaming Transport Manager: Manages Helius LaserStream gRPC/WSS connections.
 */
export class StreamingTransportManager {
  private static instance: StreamingTransportManager;
  private state: TransportState = 'DISCONNECTED';
  private telemetry: StreamingTransportTelemetry = {
    transport: 'wss',
    state: 'DISCONNECTED',
    connectedAt: null,
    lastMessageAt: null,
    messagesReceived: 0,
    messagesPerSecond: 0,
    lastSlot: 0,
    activeEndpoint: null,
    reconnectAttempts: 0,
  };

  private constructor() {}

  public static getInstance(): StreamingTransportManager {
    if (!StreamingTransportManager.instance) {
      StreamingTransportManager.instance = new StreamingTransportManager();
    }
    return StreamingTransportManager.instance;
  }

  public getActiveTransport(): any {
    return heliusLaserStreamWssManager;
  }

  public async start(): Promise<void> {
    if (this.state === 'CONNECTED' || this.state === 'CONNECTING') return;

    this.state = 'CONNECTING';
    this.telemetry.state = 'CONNECTING';

    try {
      // Explicitly start the Helius WSS manager (instantiation != startup)
      const success = await heliusLaserStreamWssManager.start();
      await laserStreamPipeline.start();

      if (success) {
        this.state = 'CONNECTED';
        this.telemetry.state = 'CONNECTED';
        this.telemetry.connectedAt = Date.now();
        console.log('[StreamingTransportManager] LaserStream transport connected.');
      } else {
        this.state = 'DEGRADED';
        this.telemetry.state = 'DEGRADED';
        console.warn('[StreamingTransportManager] LaserStream transport operating in polling fallback mode.');
      }
    } catch (err: any) {
      this.state = 'DEGRADED';
      this.telemetry.state = 'DEGRADED';
      console.warn('[StreamingTransportManager] Streaming transport active in degraded mode:', err?.message || err);
    }
  }

  public async stop(): Promise<void> {
    await heliusLaserStreamWssManager.stop();
    laserStreamPipeline.stop();
    this.state = 'DISCONNECTED';
    this.telemetry.state = 'DISCONNECTED';
    this.telemetry.connectedAt = null;
  }

  public getState(): TransportState {
    return this.state;
  }

  public getTelemetry(): StreamingTransportTelemetry {
    const wssTelemetry = heliusLaserStreamWssManager.getTelemetry();
    return {
      transport: 'wss',
      state: this.state,
      connectedAt: wssTelemetry.connectedAt,
      lastMessageAt: wssTelemetry.lastMessageAt,
      messagesReceived: wssTelemetry.messagesReceived,
      messagesPerSecond: wssTelemetry.messagesPerSecond,
      lastSlot: wssTelemetry.lastSlot,
      activeEndpoint: wssTelemetry.endpoint,
      reconnectAttempts: wssTelemetry.reconnectCount,
    };
  }

  public recordMessage(): void {
    this.telemetry.messagesReceived++;
    this.telemetry.lastMessageAt = Date.now();
  }

  public recordSlot(slot: number): void {
    this.telemetry.lastSlot = slot;
  }
}

export const streamingTransportManager = StreamingTransportManager.getInstance();
