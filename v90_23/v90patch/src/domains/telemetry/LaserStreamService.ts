import { laserStreamWatchdog } from '../../../server/services/LaserStreamWatchdog';
import { loggerService } from '../../infrastructure/logging/LoggerService';

export class LaserStreamService {
  private static instance: LaserStreamService;

  public static getInstance(): LaserStreamService {
    if (!LaserStreamService.instance) {
      LaserStreamService.instance = new LaserStreamService();
    }
    return LaserStreamService.instance;
  }

  public getStatus() {
    return laserStreamWatchdog.getMetrics();
  }

  public recordRawUpdate() {
    laserStreamWatchdog.recordRawUpdate();
  }

  public recordReceivedEvent(slot: number) {
    laserStreamWatchdog.recordReceivedEvent(slot);
    loggerService.emit('TRANSACTION_DETECTED', `LaserStream event received on slot ${slot}`, { slot });
  }

  public recordProcessedEvent(slot: number, durationMs?: number) {
    laserStreamWatchdog.recordProcessedEvent(slot, durationMs);
  }
}

export const laserStreamService = LaserStreamService.getInstance();
