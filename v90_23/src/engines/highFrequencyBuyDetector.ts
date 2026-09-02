import { eventBus } from './eventBus';

export interface TradeEvent {
  tokenAddress: string;
  token?: string;
  type: 'buy' | 'sell';
  amount: number;
  priceSol?: number;
  timestamp: number;
  maker?: string; // Wallet address
}

interface TokenBuffer {
  trades: TradeEvent[];
  lastAlertTimestamp: number;
}

export class HighFrequencyBuyDetector {
  private buffers: Map<string, TokenBuffer> = new Map();
  private readonly WINDOW_MAX_MS = 10000; // Track up to 10s
  private readonly ALERT_COOLDOWN_MS = 5000; // Prevent spamming alerts

  public analyzeTrade(trade: TradeEvent) {
    if (!trade.tokenAddress) return;

    let buffer = this.buffers.get(trade.tokenAddress);
    if (!buffer) {
      buffer = { trades: [], lastAlertTimestamp: 0 };
      this.buffers.set(trade.tokenAddress, buffer);
    }

    // Add new trade
    buffer.trades.push(trade);

    // Prune old trades
    const cutoff = Date.now() - this.WINDOW_MAX_MS;
    buffer.trades = buffer.trades.filter((t) => t.timestamp >= cutoff);

    this.evaluateBuffer(trade.tokenAddress, trade.token || trade.tokenAddress.slice(0, 6), buffer);
  }

  private evaluateBuffer(tokenAddress: string, symbol: string, buffer: TokenBuffer) {
    const now = Date.now();
    if (now - buffer.lastAlertTimestamp < this.ALERT_COOLDOWN_MS) {
      return;
    }

    const trades = buffer.trades;
    if (trades.length < 3) return; // Too few trades to matter

    // Time windows
    let buys1s = 0;
    let buys3s = 0;
    let buys5s = 0;
    let buys10s = 0;
    
    let totalBuys = 0;
    let totalSells = 0;
    let buyVolumeSol = 0;
    const uniqueWallets = new Set<string>();
    const walletBuyCounts = new Map<string, number>();

    for (const t of trades) {
      const ageMs = now - t.timestamp;
      
      if (t.type === 'buy') {
        totalBuys++;
        buyVolumeSol += (t.priceSol || 0); // Or use SOL amount if available

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
    
    // Check acceleration: more buys in recent windows
    const acceleration = (buys1s / 1) > (buys5s / 5) ? 1.5 : 1.0;

    let maxRepeatedBuys = 0;
    let coordinatedClusters = 0;
    
    for (const count of walletBuyCounts.values()) {
      if (count > maxRepeatedBuys) {
        maxRepeatedBuys = count;
      }
      if (count >= 3) {
        coordinatedClusters++; // Simple heuristic for a cluster (same wallet buying many times)
      }
    }

    // Confidence Score Calculation (0 to 100)
    let score = 0;
    score += Math.min(30, buys5s * 3); // Up to 30 points for frequency
    score += Math.min(20, uniqueWallets.size * 2); // Up to 20 for unique wallets
    score += buyToSellRatio > 5 ? 15 : (buyToSellRatio > 2 ? 5 : 0); // Up to 15 for ratio
    score += acceleration > 1.2 ? 10 : 0; // Up to 10 for acceleration
    score += maxRepeatedBuys > 3 ? 15 : 0; // Up to 15 for repeated buys from same maker
    score += coordinatedClusters > 0 ? 10 : 0; // Up to 10 for clusters

    const confidenceScore = Math.min(100, score);

    // If confidence is high enough, emit HIGH_FREQUENCY_BUY event
    if (confidenceScore >= 60 && buys5s >= 5) {
      buffer.lastAlertTimestamp = now;
      eventBus.emit('HIGH_FREQUENCY_BUY', {
        tokenAddress,
        symbol,
        confidenceScore,
        metrics: {
          buys1s,
          buys3s,
          buys5s,
          buys10s,
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
