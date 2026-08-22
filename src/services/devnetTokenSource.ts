// src/services/devnetTokenSource.ts
import { devnetTokenApi, DevnetToken } from './devnetTokenApi';
import { ScannedToken } from './tokenScanner';
import { eventBus } from '../engines/eventBus';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';

class DevnetTokenSource {
  private activeTokens: Map<string, DevnetToken> = new Map();
  private pollInterval: any = null;
  private isRunning: boolean = false;

  constructor() {
    // Initial fetch
    this.refreshTokens();
  }

  /**
   * Start polling Devnet tokens when in devnet mode
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.refreshTokens();

    this.pollInterval = setInterval(() => {
      const network = useTradingEnvironmentStore.getState().network;
      if (network === 'devnet') {
        this.simulateLiveDevnetActivity();
      }
    }, 5000);
  }

  public stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
  }

  /**
   * Refresh token registry from server
   */
  public async refreshTokens(): Promise<DevnetToken[]> {
    try {
      const tokens = await devnetTokenApi.getDevnetTokens();
      for (const t of tokens) {
        this.activeTokens.set(t.mint, t);
      }
      return tokens;
    } catch (err) {
      console.warn('[DevnetTokenSource] refreshTokens error:', err);
      return Array.from(this.activeTokens.values());
    }
  }

  /**
   * Get all Devnet tokens converted to ScannedToken format for the scanner
   */
  public async getScannedTokens(): Promise<ScannedToken[]> {
    const tokens = await this.refreshTokens();
    return tokens.map(t => this.toScannedToken(t));
  }

  /**
   * Convert DevnetToken to ScannedToken
   */
  public toScannedToken(token: DevnetToken): ScannedToken {
    return {
      address: token.mint,
      symbol: token.symbol,
      name: token.name,
      priceUsd: token.priceUsd,
      priceChange5m: (Math.random() * 8) - 1.5, // Realistic positive momentum
      priceChange1h: (Math.random() * 25) + 2,
      priceChange24h: (Math.random() * 120) + 10,
      volume24h: token.volume24h,
      liquidityUsd: token.liquidityUsd,
      fdv: token.marketCap,
      marketCap: token.marketCap,
      pairCreatedAt: token.createdAt,
      dexId: token.complete ? 'pumpswap' : 'pumpfun',
      pairAddress: token.pool || token.bondingCurve,
      url: `https://solscan.io/token/${token.mint}?cluster=devnet`,
    };
  }

  /**
   * Ingest a newly generated Devnet test token into live engine
   */
  public notifyNewTokenCreated(token: DevnetToken): void {
    this.activeTokens.set(token.mint, token);
    const scanned = this.toScannedToken(token);

    // Emit event so Scanner and Trading Engine instantly see it
    eventBus.emit('NEW_TOKEN', {
      tokenAddress: token.mint,
      symbol: token.symbol,
      data: {
        ...scanned,
        isNewDiscovery: true,
        isDevnetTestToken: true,
      },
    });

    console.log(`[DevnetTokenSource] Ingested newly created token ${token.symbol} (${token.mint})`);
  }

  /**
   * Simulate gentle live price updates for Devnet tokens
   */
  private simulateLiveDevnetActivity(): void {
    for (const [mint, token] of this.activeTokens.entries()) {
      // 70% chance to update
      if (Math.random() < 0.7) {
        const deltaPct = (Math.random() * 0.04) - 0.015; // -1.5% to +2.5%
        token.priceUsd = Math.max(0.000001, token.priceUsd * (1 + deltaPct));
        token.priceSol = Math.max(0.00000001, token.priceSol * (1 + deltaPct));
        token.marketCap = Math.max(1000, token.marketCap * (1 + deltaPct));
        token.volume24h += Math.floor(Math.random() * 500);

        // Emit updated price if needed
        eventBus.emit('PRICE_UPDATE', {
          tokenAddress: mint,
          symbol: token.symbol,
          priceUsd: token.priceUsd,
          priceSol: token.priceSol,
          marketCap: token.marketCap,
        });
      }
    }
  }
}

export const devnetTokenSource = new DevnetTokenSource();
// Start background activity on load
devnetTokenSource.start();
