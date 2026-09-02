export class MarketHealthService {
  private static instance: MarketHealthService;
  private isHealthy = true;

  public static getInstance(): MarketHealthService {
    if (!MarketHealthService.instance) {
      MarketHealthService.instance = new MarketHealthService();
    }
    return MarketHealthService.instance;
  }

  public getStatus(): { healthy: boolean } {
    return { healthy: this.isHealthy };
  }

  public setHealthy(healthy: boolean): void {
    this.isHealthy = healthy;
  }
}

export const marketHealthService = MarketHealthService.getInstance();
