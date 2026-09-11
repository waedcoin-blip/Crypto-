// src/services/tradingEngine.ts
/**
 * Frontend Trading Engine Client:
 * All execution authority is delegated directly to the authoritative backend TradingEngine.
 */
export class TradingEngineClient {
  private static instance: TradingEngineClient;

  public static getInstance(): TradingEngineClient {
    if (!TradingEngineClient.instance) {
      TradingEngineClient.instance = new TradingEngineClient();
    }
    return TradingEngineClient.instance;
  }

  public async buy(params: {
    network?: string;
    wallet?: string;
    mint: string;
    amountSol: number;
    slippageBps?: number;
    tpPct?: number;
    slPct?: number;
  }) {
    const res = await fetch('/api/trading/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  public async sell(params: {
    network?: string;
    wallet?: string;
    mint: string;
    amountRaw?: string | number;
    percent?: number;
    slippageBps?: number;
    reason?: string;
  }) {
    const res = await fetch('/api/trading/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  public async getPositions() {
    const res = await fetch('/api/trading/positions');
    return res.json();
  }
}

export const tradingEngine = TradingEngineClient.getInstance();
