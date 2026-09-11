import { useState, useCallback } from 'react';

export interface BuyRequestParams {
  network?: string;
  wallet?: string;
  mint: string;
  amountSol: number;
  slippageBps?: number;
  tpPct?: number;
  slPct?: number;
  label?: string;
}

export interface SellRequestParams {
  network?: string;
  wallet?: string;
  mint: string;
  amountRaw?: string | number;
  slippageBps?: number;
  reason?: string;
}

export interface TradeActionResult {
  success: boolean;
  orderId?: string;
  positionId?: string;
  signature?: string;
  error?: string;
  status?: string;
  reason?: string;
}

export function useTradingActions() {
  const [isBuying, setIsBuying] = useState(false);
  const [isSelling, setIsSelling] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const executeBuy = useCallback(async (params: BuyRequestParams): Promise<TradeActionResult> => {
    setIsBuying(true);
    setLastError(null);
    try {
      const res = await fetch('/api/trading/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          network: params.network || 'paper',
          wallet: params.wallet || 'default',
          mint: params.mint,
          amountSol: params.amountSol,
          slippageBps: params.slippageBps ?? 250,
          tpPct: params.tpPct,
          slPct: params.slPct,
          label: params.label || 'MANUAL_UI',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        const errorMsg = data.error || data.reason || 'Buy request failed';
        setLastError(errorMsg);
        return { success: false, error: errorMsg, ...data };
      }

      return {
        success: true,
        orderId: data.orderId,
        positionId: data.positionId,
        signature: data.signature,
        status: data.status,
      };
    } catch (err: any) {
      const msg = err?.message || 'Network error during buy execution';
      setLastError(msg);
      return { success: false, error: msg };
    } finally {
      setIsBuying(false);
    }
  }, []);

  const executeSell = useCallback(async (params: SellRequestParams): Promise<TradeActionResult> => {
    setIsSelling(true);
    setLastError(null);
    try {
      const res = await fetch('/api/trading/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          network: params.network || 'paper',
          wallet: params.wallet || 'default',
          mint: params.mint,
          amountRaw: params.amountRaw,
          slippageBps: params.slippageBps ?? 300,
          reason: params.reason || 'MANUAL_UI_EXIT',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        const errorMsg = data.error || data.reason || 'Sell request failed';
        setLastError(errorMsg);
        return { success: false, error: errorMsg, ...data };
      }

      return {
        success: true,
        orderId: data.orderId,
        positionId: data.positionId,
        signature: data.signature,
        status: data.status,
      };
    } catch (err: any) {
      const msg = err?.message || 'Network error during sell execution';
      setLastError(msg);
      return { success: false, error: msg };
    } finally {
      setIsSelling(false);
    }
  }, []);

  return {
    executeBuy,
    executeSell,
    isBuying,
    isSelling,
    lastError,
  };
}
