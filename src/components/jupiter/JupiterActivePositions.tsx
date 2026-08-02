import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, XCircle, Shield, Zap, RefreshCw } from 'lucide-react';
import { JupiterTokenMetadata } from '../../services/jupiter/tokenSearchService';

export interface JupiterPosition {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  buyPrice: number;
  currentPrice: number;
  amount: number;
  solSpent: number;
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopEnabled: boolean;
  highestPrice: number;
  openTime: number;
  mode: 'PAPER' | 'REAL';
}

interface JupiterActivePositionsProps {
  onClosePosition: (id: string, reason: string) => void;
}

export const JupiterActivePositions: React.FC<JupiterActivePositionsProps> = ({ onClosePosition }) => {
  const [positions, setPositions] = useState<JupiterPosition[]>([]);

  useEffect(() => {
    const loadPositions = () => {
      const saved = localStorage.getItem('jupiter_standalone_positions');
      if (saved) {
        try {
          setPositions(JSON.parse(saved));
        } catch {
          setPositions([]);
        }
      }
    };
    loadPositions();
    const interval = setInterval(loadPositions, 2000);
    return () => clearInterval(interval);
  }, []);

  if (positions.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center font-mono space-y-2">
        <Activity className="w-8 h-8 text-slate-600 mx-auto animate-pulse" />
        <h4 className="text-xs font-bold text-white uppercase tracking-wider">No Active Jupiter Positions</h4>
        <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
          Execute a BUY trade or pick profitable tokens to start independent automated position monitoring.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3 font-mono">
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Active Jupiter Positions ({positions.length})
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase">
              <th className="pb-2.5 font-medium">Token</th>
              <th className="pb-2.5 font-medium">Mode</th>
              <th className="pb-2.5 font-medium">Spent SOL</th>
              <th className="pb-2.5 font-medium">Entry</th>
              <th className="pb-2.5 font-medium">Current</th>
              <th className="pb-2.5 font-medium">PnL</th>
              <th className="pb-2.5 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {positions.map((pos) => {
              const currentVal = pos.currentPrice * pos.amount;
              const pnlSol = currentVal - pos.solSpent;
              const pnlPct = pos.solSpent > 0 ? (pnlSol / pos.solSpent) * 100 : 0;
              const isProfit = pnlSol >= 0;

              return (
                <tr key={pos.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 font-bold text-white">
                    <div className="flex items-center gap-1.5">
                      <span>{pos.symbol}</span>
                      <span className="text-[9px] text-slate-500 font-normal">({pos.mint.slice(0, 4)}...)</span>
                    </div>
                  </td>
                  <td className="py-3">
                    <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${pos.mode === 'REAL' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}`}>
                      {pos.mode}
                    </span>
                  </td>
                  <td className="py-3 text-slate-300">{pos.solSpent.toFixed(4)} SOL</td>
                  <td className="py-3 text-slate-400">${pos.buyPrice.toFixed(6)}</td>
                  <td className="py-3 text-white font-medium">${pos.currentPrice.toFixed(6)}</td>
                  <td className="py-3">
                    <span className={`font-bold flex items-center gap-1 ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {isProfit ? '+' : ''}{pnlPct.toFixed(2)}% ({pnlSol.toFixed(4)} SOL)
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => onClosePosition(pos.id, 'Manual Close')}
                      className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white rounded-lg text-[10px] font-bold uppercase transition-all border border-rose-500/30 cursor-pointer"
                    >
                      Close
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
