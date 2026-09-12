import { useState, useEffect, useCallback } from 'react';

export interface PositionItem {
  id: string;
  network: string;
  wallet: string;
  mint: string;
  symbol?: string;
  tokenAmount: number;
  tokenAmountRaw?: string;
  decimals: number;
  averageEntryPrice: number;
  currentPriceSol: number | null;
  unrealizedPnlSol: number | null;
  unrealizedPnlPct: number | null;
  valStatus?: 'LIVE' | 'STALE' | 'UNAVAILABLE' | string;
  valSource?: string;
  hasLiveMarketPrice?: boolean;
  realizedPnlSol?: number;
  status: 'OPEN' | 'CLOSING' | 'CLOSED' | string;
  openedAt?: number;
  closedAt?: number;
  highestPnLPct?: number;
  tpPct?: number;
  slPct?: number;
  orderIds?: string[];
  buySignature?: string;
  exitSignature?: string;
}

export interface PortfolioPnL {
  totalCostSol: number;
  totalCurrentValueSol: number;
  totalUnrealizedSol: number;
  totalRealizedSol: number;
  portfolioPnlPct: number;
}

export function usePositions(pollIntervalMs: number = 3000) {
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [portfolioPnL, setPortfolioPnL] = useState<PortfolioPnL | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch('/api/trading/positions');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to fetch positions`);
      }
      const data = await res.json();
      if (data.status === 'success') {
        const rawPositions = data.positions || [];
        const mapped: PositionItem[] = rawPositions.map((p: any) => ({
          id: p.id || `${p.network}:${p.wallet}:${p.mint}`,
          network: p.network || 'paper',
          wallet: p.wallet || 'default',
          mint: p.mint,
          symbol: p.symbol || p.mint?.slice(0, 6),
          tokenAmount: p.tokenAmount ?? (p.amountRaw ? Number(p.amountRaw) / Math.pow(10, p.decimals || 9) : 0),
          tokenAmountRaw: p.tokenAmountRaw || p.amountRaw,
          decimals: p.decimals || 9,
          averageEntryPrice: p.averageEntryPrice ?? p.entryPrice ?? p.priceSolPerToken ?? 0,
          currentPriceSol: p.currentPriceSol ?? null,
          unrealizedPnlSol: p.unrealizedPnlSol ?? null,
          unrealizedPnlPct: p.unrealizedPnlPct ?? null,
          valStatus: p.valStatus ?? 'UNAVAILABLE',
          valSource: p.valSource,
          hasLiveMarketPrice: p.hasLiveMarketPrice ?? false,
          realizedPnlSol: p.realizedPnlSol ?? 0,
          status: p.status || p.state || 'OPEN',
          openedAt: p.openedAt || p.createdAt,
          closedAt: p.closedAt,
          highestPnLPct: p.highestPnLPct,
          tpPct: p.tpPct,
          slPct: p.slPct,
          orderIds: p.orderIds,
          buySignature: p.buySignature,
          exitSignature: p.exitSignature,
        }));
        setPositions(mapped);
        if (data.portfolioPnL) {
          setPortfolioPnL(data.portfolioPnL);
        }
        setError(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load positions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
    if (pollIntervalMs > 0) {
      const interval = setInterval(fetchPositions, pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchPositions, pollIntervalMs]);

  return {
    positions,
    portfolioPnL,
    isLoading,
    error,
    refresh: fetchPositions,
  };
}
