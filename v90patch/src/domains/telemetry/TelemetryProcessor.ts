import { telemetryService } from '../../services/telemetryService';
import { loggerService } from '../../infrastructure/logging/LoggerService';

export class TelemetryProcessor {
  public static recordApiCall(endpoint: string, method: string, status: number, latencyMs: number, error?: string) {
    telemetryService.recordApiRequest(endpoint, method, status, latencyMs, error);
    if (error) {
      loggerService.emit('RPC_FAILOVER', `API Error on ${method} (${endpoint}): ${error}`, { level: 'warn' });
    }
  }

  public static getMetrics() {
    return telemetryService.getMetricsSummary();
  }
}
