// shared/highFrequencyBuyDetector.ts (Adjust path as needed)
import { eventBus } from './eventBus';

export interface TradeEvent {
  tokenAddress: string;
  token?: string;
  type: 'buy' | 'sell';
  amount: number;       // Token amount
  priceSol?: number;    // Price per token in SOL
  timestamp: number;
  maker?: string; 
}

interface TokenBuffer {
  trades: TradeEvent[];
  lastAlertTimestamp: number;
}

export class HighFrequencyBuyDetector {
  private buffers: Map<string, TokenBuffer> = new Map();
  private readonly WINDOW_MAX_MS = 10000; 
  private readonly ALERT_COOLDOWN_MS = 5000; 

  public analyzeTrade(trade: TradeEvent) {
    if (!trade.tokenAddress) return;

    let buffer = this.buffers.get(trade.tokenAddress);
    if (!buffer) {
      buffer = { trades: [], lastAlertTimestamp: 0 };
      this.buffers.set(trade.tokenAddress, buffer);
    }

    buffer.trades.push(trade);

    // Prune old trades
    const cutoff = Date.now() - this.WINDOW_MAX_MS;
    buffer.trades = buffer.trades.filter((t) => t.timestamp >= cutoff);

    this.evaluateBuffer(trade.tokenAddress, trade.token || trade.tokenAddress.slice(0, 6), buffer);
  }

  // NEW: Expose state for backend API monitoring
  public getDetectorState() {
    const state: Record<string, { tradeCount: number; lastAlert: number }> = {};
    for (const [tokenAddress, buffer] of this.buffers.entries()) {
      state[tokenAddress] = {
        tradeCount: buffer.trades.length,
        lastAlert: buffer.lastAlertTimestamp
      };
    }
    return state;
  }

  private evaluateBuffer(tokenAddress: string, symbol: string, buffer: TokenBuffer) {
    const now = Date.now();
    if (now - buffer.lastAlertTimestamp < this.ALERT_COOLDOWN_MS) return;

    const trades = buffer.trades;
    if (trades.length < 3) return; 

    let buys1s = 0, buys3s = 0, buys5s = 0, buys10s = 0;
    let totalBuys = 0, totalSells = 0, buyVolumeSol = 0;
    const uniqueWallets = new Set<string>();
    const walletBuyCounts = new Map<string, number>();

    for (const t of trades) {
      const ageMs = now - t.timestamp;
      if (t.type === 'buy') {
        totalBuys++;
        // FIX: Calculate actual SOL volume (Token Amount * Price per Token)
        buyVolumeSol += (t.amount * (t.priceSol || 0)); 
        
        if (ageMs <= 1000) buys1s++;
        if (ageMs <= 3000) buys3s++;
        if (ageMs <= 5000) buys5s++;
        if (ageMs <= 10000) buys10s++;
        
        if (t.maker) {
          uniqueWallets.add(t.maker);
          walletBuyCounts.set(t.maker, (walletBuyCounts.get(t.maker) || 0) + 1);
        }
      } else if (t.type === 'sell') {
        totalSells++;
      }
    }

    if (totalBuys === 0) return;

    const buyToSellRatio = totalSells > 0 ? totalBuys / totalSells : totalBuys;
    const acceleration = (buys1s / 1) > (buys5s / 5) ? 1.5 : 1.0;

    let maxRepeatedBuys = 0;
    let coordinatedClusters = 0;
    for (const count of walletBuyCounts.values()) {
      if (count > maxRepeatedBuys) maxRepeatedBuys = count;
      if (count >= 3) coordinatedClusters++; 
    }

    // Confidence Score Calculation (0 to 100)
    let score = 0;
    score += Math.min(30, buys5s * 3); 
    score += Math.min(20, uniqueWallets.size * 2); 
    score += buyToSellRatio > 5 ? 15 : (buyToSellRatio > 2 ? 5 : 0); 
    score += acceleration > 1.2 ? 10 : 0; 
    score += maxRepeatedBuys > 3 ? 15 : 0; 
    score += coordinatedClusters > 0 ? 10 : 0; 

    const confidenceScore = Math.min(100, score);

    if (confidenceScore >= 60 && buys5s >= 5) {
      buffer.lastAlertTimestamp = now;
      eventBus.emit('HIGH_FREQUENCY_BUY', {
        tokenAddress,
        symbol,
        confidenceScore,
        metrics: {
          buys1s, buys3s, buys5s, buys10s,
          uniqueWallets: uniqueWallets.size,
          buyToSellRatio: parseFloat(buyToSellRatio.toFixed(2)),
          acceleration,
          maxRepeatedBuys,
          coordinatedClusters,
          buyVolumeSol: parseFloat(buyVolumeSol.toFixed(4)),
        },
        timestamp: now,
      });
    }
  }
}

export const highFrequencyBuyDetector = new HighFrequencyBuyDetector();