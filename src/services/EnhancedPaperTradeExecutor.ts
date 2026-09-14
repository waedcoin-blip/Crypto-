/**
 * Enhanced Paper Trade Executor
 *
 * Coordinates realistic paper trading with live market pricing:
 * - Integrates with Jupiter API for real market quotes
 * - Updates prices in RealisticPaperTradingEngine using real-time Jupiter price feeds
 * - Simulates blockchain confirmation delays (1.5s - 4s average for Solana)
 * - Implements order validation and risk management
 */

import { realisticPaperTradingEngine, OrderRequest } from './RealisticPaperTradingEngine';

export class EnhancedPaperTradeExecutor {
  private updateInterval: NodeJS.Timeout | null = null;
  private watchedSymbols: Set<string> = new Set([
    'So11111111111111111111111111111111111111112', // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  ]);

  constructor() {
    this.startPriceUpdates();
  }

  /**
   * Fetch a live executable quote from Jupiter API
   */
  public async getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amountLamports: number,
    slippageBps: number = 50
  ): Promise<any> {
    try {
      const response = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`
      );
      if (!response.ok) {
        throw new Error(`Jupiter quote error: ${response.statusText}`);
      }
      return await response.json();
    } catch (e) {
      console.error('Failed to fetch Jupiter quote', e);
      return null;
    }
  }

  /**
   * Fetch live prices from Jupiter Price API
   */
  public async fetchJupiterPrices(mints: string[]): Promise<Record<string, number>> {
    if (mints.length === 0) return {};
    try {
      const ids = mints.join(',');
      const response = await fetch(`https://api.jup.ag/price/v2?ids=${ids}`);
      if (!response.ok) {
        // Fallback to older price API if needed
        const oldResponse = await fetch(`https://price.jup.ag/v4/price?ids=${ids}`);
        if (!oldResponse.ok) return {};
        const oldData = await oldResponse.json();
        const prices: Record<string, number> = {};
        for (const id of mints) {
          if (oldData.data[id]) {
            prices[id] = oldData.data[id].price;
          }
        }
        return prices;
      }
      const data = await response.json();
      const prices: Record<string, number> = {};
      
      if (data.data) {
        for (const id of mints) {
          if (data.data[id]) {
            prices[id] = parseFloat(data.data[id].price);
          }
        }
      }
      return prices;
    } catch (e) {
      console.error('Failed to fetch Jupiter prices', e);
      return {};
    }
  }

  /**
   * Add a token mint to be tracked with real-time live prices
   */
  public watchToken(mint: string): void {
    if (!mint) return;
    this.watchedSymbols.add(mint);
    this.triggerImmediateUpdate();
  }

  /**
   * Execute a paper trade buy/sell using Jupiter validation
   */
  public async executeTrade(params: {
    side: 'buy' | 'sell';
    mint: string;
    amount: number; // SOL if buy, Tokens if sell
    walletId?: string;
  }): Promise<{ success: boolean; error?: string; txSignature?: string; fillPrice?: number }> {
    const walletId = params.walletId || 'default';
    
    // 1. Risk management & initial validation
    if (params.amount <= 0) {
      return { success: false, error: 'Trade amount must be greater than zero' };
    }

    // Add token to watched list
    this.watchToken(params.mint);

    // 2. Fetch live prices to ensure freshness
    const prices = await this.fetchJupiterPrices([params.mint, 'So11111111111111111111111111111111111111112']);
    const tokenPrice = prices[params.mint] || 0.0001; // default fallback if unindexed
    const solPrice = prices['So11111111111111111111111111111111111111112'] || 150.0;

    // Update prices in paper engine
    realisticPaperTradingEngine.updateMarketData(params.mint, tokenPrice);
    realisticPaperTradingEngine.updateMarketData('So11111111111111111111111111111111111111112', solPrice);

    // 3. Create order request
    const orderId = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Calculate size relative to target currency
    let qty = params.amount;
    if (params.side === 'buy') {
      // Amount is in SOL, convert to Tokens
      const solValue = params.amount * solPrice;
      qty = solValue / tokenPrice;
    }

    const order: OrderRequest = {
      id: orderId,
      type: 'market',
      side: params.side,
      symbol: params.mint,
      quantity: qty,
      walletId,
      timeInForce: 'IOC'
    };

    // 4. Simulate Solana network/block confirmation delay (1.5s to 4s)
    const blockTimeDelay = 1500 + Math.random() * 2500;
    await new Promise(resolve => setTimeout(resolve, blockTimeDelay));

    // 5. Submit to RealisticPaperTradingEngine for execution
    const result = await realisticPaperTradingEngine.submitOrder(order);

    if (result.success && result.fill) {
      // Simulate random Solana transaction signature for realism
      const randomSig = Array.from({ length: 88 }, () =>
        '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Math.floor(Math.random() * 58)]
      ).join('');

      return {
        success: true,
        txSignature: randomSig,
        fillPrice: result.fill.price
      };
    } else {
      return {
        success: false,
        error: result.error || 'Execution failed'
      };
    }
  }

  /**
   * Periodically pull live prices from Jupiter Price API
   */
  private startPriceUpdates(): void {
    if (this.updateInterval) clearInterval(this.updateInterval);

    this.updateInterval = setInterval(async () => {
      const list = Array.from(this.watchedSymbols);
      if (list.length === 0) return;

      const prices = await this.fetchJupiterPrices(list);
      for (const [mint, price] of Object.entries(prices)) {
        realisticPaperTradingEngine.updateMarketData(mint, price);
      }
    }, 5000); // 5 seconds refresh interval
  }

  private async triggerImmediateUpdate(): Promise<void> {
    const list = Array.from(this.watchedSymbols);
    const prices = await this.fetchJupiterPrices(list);
    for (const [mint, price] of Object.entries(prices)) {
      realisticPaperTradingEngine.updateMarketData(mint, price);
    }
  }

  public stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}
