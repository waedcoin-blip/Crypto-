import React from 'react';
import { usePositions } from '../hooks/usePositions';
import { useTradingActions } from '../hooks/useTradingActions';
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react';

export function ActivePositionsTable() {
  const { positions, portfolioPnL, isLoading } = usePositions(3000); // Poll every 3s
  const { executeSell, isSelling } = useTradingActions();

  if (isLoading && positions.length === 0) {
    return <div className="text-center text-[#64748b] text-xs py-8">Loading positions from backend...</div>;
  }

  return (
    <div className="bg-[#0f111a] border border-[#2d2e3d] rounded-xl overflow-hidden">
      {/* Portfolio Summary */}
      {portfolioPnL && (
        <div className="grid grid-cols-4 gap-4 p-4 border-b border-[#2d2e3d] bg-[#050509]">
          <div>
            <div className="text-[10px] text-[#64748b] uppercase">Total Cost</div>
            <div className="text-sm font-mono text-white">{(portfolioPnL.totalCostSol || 0).toFixed(4)} SOL</div>
          </div>
          <div>
            <div className="text-[10px] text-[#64748b] uppercase">Unrealized PnL</div>
            <div className={`text-sm font-mono ${(portfolioPnL.totalUnrealizedSol || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {(portfolioPnL.totalUnrealizedSol || 0) >= 0 ? '+' : ''}{(portfolioPnL.totalUnrealizedSol || 0).toFixed(4)} SOL
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#64748b] uppercase">Realized PnL</div>
            <div className={`text-sm font-mono ${(portfolioPnL.totalRealizedSol || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {(portfolioPnL.totalRealizedSol || 0) >= 0 ? '+' : ''}{(portfolioPnL.totalRealizedSol || 0).toFixed(4)} SOL
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#64748b] uppercase">Portfolio %</div>
            <div className={`text-sm font-bold ${(portfolioPnL.portfolioPnlPct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {(portfolioPnL.portfolioPnlPct || 0) >= 0 ? '+' : ''}{(portfolioPnL.portfolioPnlPct || 0).toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {/* Positions List */}
      <div className="divide-y divide-[#2d2e3d]">
        {positions.length === 0 ? (
          <div className="text-center text-[#64748b] text-xs py-8">No open positions. Backend scanner is active.</div>
        ) : (
          positions.map((pos) => (
            <div key={pos.id} className="flex items-center justify-between p-3 hover:bg-[#1b1c26] transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#2d2e3d] flex items-center justify-center text-[10px] font-bold text-white">
                  {pos.symbol?.slice(0, 2) || '??'}
                </div>
                <div>
                  <div className="text-xs font-bold text-white">{pos.symbol || pos.mint.slice(0, 6)}</div>
                  <div className="text-[10px] text-[#64748b] font-mono">{pos.mint.slice(0, 4)}...{pos.mint.slice(-4)}</div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-[10px] text-[#64748b]">Entry</div>
                  <div className="text-xs font-mono text-white">{(pos.averageEntryPrice || 0).toFixed(6)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-[#64748b]">Current</div>
                  <div className="text-xs font-mono text-white">
                    {pos.valStatus === 'UNAVAILABLE' || pos.currentPriceSol == null
                      ? '--'
                      : (pos.currentPriceSol || 0).toFixed(6)}
                  </div>
                </div>
                <div className="text-right min-w-[60px]">
                  <div className="text-[10px] text-[#64748b]">PnL</div>
                  {pos.valStatus === 'UNAVAILABLE' || pos.unrealizedPnlPct == null ? (
                    <div className="text-xs font-bold text-slate-400">UNAVAILABLE</div>
                  ) : (
                    <div className={`text-xs font-bold flex items-center justify-end gap-1 ${pos.unrealizedPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {pos.unrealizedPnlPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {pos.unrealizedPnlPct.toFixed(2)}%
                    </div>
                  )}
                </div>
                <button
                  onClick={() => executeSell({ network: pos.network, mint: pos.mint })}
                  disabled={isSelling || pos.status !== 'OPEN'}
                  className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-bold rounded transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isSelling ? <Loader2 className="w-3 h-3 animate-spin" /> : 'EXIT'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
