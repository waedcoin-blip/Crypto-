/**
 * Shared Price Tracker for Candidates / Sniper Engine
 * Ensures that before a trade is placed, the token has been "in profit" (rising)
 * over the last 2 seconds.
 */

interface PriceTick {
  price: number;
  timestamp: number;
}

// A global sliding window of price ticks per token mint
const candidatePriceHistories: Record<string, PriceTick[]> = {};

export function clearPriceHistories() {
  for (const key of Object.keys(candidatePriceHistories)) {
    delete candidatePriceHistories[key];
  }
}

/**
 * Registers a new price tick for a token candidate
 * @param tokenAddress The mint address of the token
 * @param price The current price of the token (Native or USD)
 */
export function recordCandidatePrice(tokenAddress: string, price: number) {
  if (!tokenAddress || typeof price !== 'number' || isNaN(price) || price <= 0) return;

  const now = Date.now();
  if (!candidatePriceHistories[tokenAddress]) {
    candidatePriceHistories[tokenAddress] = [];
  }

  const history = candidatePriceHistories[tokenAddress];
  history.push({ price, timestamp: now });

  // Clean up entries older than 5 seconds to prevent memory leaks
  const cutoff = now - 5000;
  while (history.length > 0 && history[0].timestamp < cutoff) {
    history.shift();
  }
  
  if (history.length === 0) {
    delete candidatePriceHistories[tokenAddress];
  }
}

/**
 * Checks if the token's current price is higher than the price recorded ~2 seconds ago.
 * Returns true if the token is in profit over the last 2 seconds.
 * 
 * @param tokenAddress The mint address of the token
 * @param currentPrice The current price of the token
 * @returns { inProfit: boolean; reason: string }
 */
export function checkTokenInProfitLast2Seconds(
  tokenAddress: string,
  currentPrice: number
): { inProfit: boolean; reason: string } {
  const now = Date.now();
  const history = candidatePriceHistories[tokenAddress] || [];

  if (history.length < 2) {
    return {
      inProfit: false,
      reason: `Insufficient price ticks (Have ${history.length}, need at least 2 ticks to confirm trend)`
    };
  }

  // Target window for comparison: 1.5s to 2.5s ago
  const targetTimeMin = now - 2500;
  const targetTimeMax = now - 1500;

  // Find entries within the target 2-second window
  const candidatesInWindow = history.filter(
    h => h.timestamp >= targetTimeMin && h.timestamp <= targetTimeMax
  );

  let baselineEntry: PriceTick | null = null;
  if (candidatesInWindow.length > 0) {
    // Choose the oldest tick in the window
    baselineEntry = candidatesInWindow[0];
  } else {
    // Fallback: Find closest tick older than 1.5 seconds
    const olderEntries = history.filter(h => h.timestamp < targetTimeMax);
    if (olderEntries.length > 0) {
      baselineEntry = olderEntries[olderEntries.length - 1];
    }
  }

  if (!baselineEntry) {
    // We have ticks, but they are all very recent (e.g. less than 1.5s old)
    // We must wait until we have a baseline to prevent blind entry
    const oldestAgeSec = ((now - history[0].timestamp) / 1000).toFixed(1);
    return {
      inProfit: false,
      reason: `Price history is too fresh (oldest tick is only ${oldestAgeSec}s old, need >=1.5s)`
    };
  }

  const oldPrice = baselineEntry.price;
  const elapsedSec = (now - baselineEntry.timestamp) / 1000;

  // Compare prices
  if (currentPrice > oldPrice) {
    const profitPct = ((currentPrice - oldPrice) / oldPrice) * 100;
    return {
      inProfit: true,
      reason: `Token is in profit: rose +${profitPct.toFixed(2)}% in the last ${elapsedSec.toFixed(1)}s (from ${oldPrice.toFixed(8)} to ${currentPrice.toFixed(8)})`
    };
  } else {
    const lossPct = ((oldPrice - currentPrice) / oldPrice) * 100;
    return {
      inProfit: false,
      reason: `Token not in profit: fell -${lossPct.toFixed(2)}% in the last ${elapsedSec.toFixed(1)}s (from ${oldPrice.toFixed(8)} to ${currentPrice.toFixed(8)})`
    };
  }
}
