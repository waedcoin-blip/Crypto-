import { laserStreamWatchdog } from '../../../server/services/LaserStreamWatchdog';
import { loggerService } from '../../infrastructure/logging/LoggerService';

export class YellowstoneService {
  private static instance: YellowstoneService;

  public static getInstance(): YellowstoneService {
    if (!YellowstoneService.instance) {
      YellowstoneService.instance = new YellowstoneService();
    }
    return YellowstoneService.instance;
  }

  public getStatus() {
    return laserStreamWatchdog.getMetrics();
  }

  public recordRawUpdate() {
    laserStreamWatchdog.recordRawUpdate();
  }

  public recordReceivedEvent(slot: number) {
    laserStreamWatchdog.recordReceivedEvent(slot);
    loggerService.emit('TRANSACTION_DETECTED', `Yellowstone event received on slot ${slot}`, { slot });
  }

  public recordProcessedEvent(slot: number, durationMs?: number) {
    laserStreamWatchdog.recordProcessedEvent(slot, durationMs);
  }
}

export const laserStreamService = YellowstoneService.getInstance();
