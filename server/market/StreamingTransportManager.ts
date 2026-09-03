// server/market/StreamingTransportManager.ts
import { config, getHeliusApiKey } from '../config/index.js';
import {
  StreamingTransport,
  StreamingTransportTelemetry,
  StreamEventCallback,
} from './StreamingTransport.js';
import { heliusLaserStreamWssManager } from './HeliusLaserStreamWssManager.js';
import { yellowstoneConnectionManager } from './YellowstoneConnectionManager.js';
import { laserLogger } from '../utils/logger.js';
import { laserStreamWatchdog } from '../services/LaserStreamWatchdog.js';
import { maskApiKey } from './HeliusErrors.js';

export type ConfiguredTransport = 'wss' | 'grpc' | 'auto';

export class StreamingTransportManager {
  private static instance: StreamingTransportManager;
  private activeTransport: StreamingTransport = heliusLaserStreamWssManager;
  private configuredMode: ConfiguredTransport = 'wss';

  private constructor() {
    this.configuredMode = (process.env.HELIUS_STREAM_TRANSPORT as ConfiguredTransport) || 'wss';
    this.resolveActiveTransport();
  }

  public static getInstance(): StreamingTransportManager {
    if (!StreamingTransportManager.instance) {
      StreamingTransportManager.instance = new StreamingTransportManager();
    }
    return StreamingTransportManager.instance;
  }

  private resolveActiveTransport(): void {
    // If explicitly set to 'grpc', check if gRPC credentials exist
    if (this.configuredMode === 'grpc') {
      const xToken = process.env.YELLOWSTONE_GRPC_X_TOKEN || getHeliusApiKey();
      const endpoint = process.env.YELLOWSTONE_GRPC_ENDPOINT;
      if (xToken && endpoint) {
        // gRPC configured
        laserLogger.info('[STREAMING TRANSPORT] Selected gRPC transport mode (Yellowstone)');
        return;
      }
      laserLogger.warn(
        '[STREAMING TRANSPORT] gRPC transport requested but credentials not fully set. Falling back to Helius Standard WSS.'
      );
    }

    // Default: Helius Standard WSS
    this.activeTransport = heliusLaserStreamWssManager;
    laserLogger.info('[STREAMING TRANSPORT] Authoritative transport: Helius Standard WSS');
  }

  public async start(callback?: StreamEventCallback): Promise<boolean> {
    const apiKey = getHeliusApiKey();
    if (!apiKey) {
      laserLogger.warn('[STREAMING TRANSPORT] HELIUS_API_KEY not configured. Real-time streaming waiting for API key.');
      return false;
    }

    return this.activeTransport.start(callback || (() => {}));
  }

  public async stop(): Promise<void> {
    await this.activeTransport.stop();
  }

  public getActiveTransport(): StreamingTransport {
    return this.activeTransport;
  }

  public getTelemetry(): StreamingTransportTelemetry {
    return this.activeTransport.getTelemetry();
  }

  public isHealthy(): boolean {
    return this.activeTransport.isHealthy();
  }

  public printDiagnostics(): void {
    const apiKey = getHeliusApiKey();
    const telemetry = this.getTelemetry();

    console.log('\n════════════════ STREAMING TRANSPORT DIAGNOSTICS ════════════════');
    console.log(` MODE:          ${this.configuredMode.toUpperCase()}`);
    console.log(` ACTIVE:        ${this.activeTransport.transportName.toUpperCase()}`);
    console.log(` API KEY:       ${apiKey ? 'CONFIGURED (' + maskApiKey(apiKey) + ')' : 'MISSING'}`);
    console.log(` STATUS:        ${telemetry.status.toUpperCase()}`);
    console.log(` CONNECTED:     ${telemetry.connected ? 'YES' : 'NO'}`);
    console.log(` LAST SLOT:     ${telemetry.lastSlot || 'NONE'}`);
    console.log(` MESSAGES:      ${telemetry.messagesReceived} (${telemetry.messagesPerSecond.toFixed(1)}/s)`);
    console.log('═════════════════════════════════════════════════════════════════\n');
  }
}

export const streamingTransportManager = StreamingTransportManager.getInstance();
