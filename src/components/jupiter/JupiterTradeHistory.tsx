import React, { useState, useEffect } from 'react';
import { History, TrendingUp, TrendingDown, Clock, ShieldCheck } from 'lucide-react';

export interface JupiterTradeRecord {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  buyTime: number;
  sellTime: number;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  buyAmountSol: number;
  sellAmountSol: number;
  pnlSol: number;
  pnlPct: number;
  exitReason: string;
  mode: 'PAPER' | 'REAL';
  txSignature?: string;
}

export const JupiterTradeHistory: React.FC = () => {
  const [history, setHistory] = useState<JupiterTradeRecord[]>([]);

  useEffect(() => {
    const loadHistory = () => {
      const saved = localStorage.getItem('jupiter_standalone_tradeHistory');
      if (saved) {
        try {
          setHistory(JSON.parse(saved));
        } catch {
          setHistory([]);
        }
      }
    };
    loadHistory();
    const interval = setInterval(loadHistory, 3000);
    return () => clearInterval(interval);
  }, []);

  const clearHistory = () => {
    localStorage.removeItem('jupiter_standalone_tradeHistory');
    setHistory([]);
  };

  if (history.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center font-mono space-y-2">
        <History className="w-8 h-8 text-slate-600 mx-auto" />
        <h4 className="text-xs font-bold text-white uppercase tracking-wider">No Jupiter Trade History</h4>
        <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
          Completed Jupiter trades (Paper or Real) will automatically appear here with full PnL breakdown.
        </p>
      </div>
    );
  }

  const totalBuySol = history.reduce((acc, t) => acc + (t.buyAmountSol || 0), 0);
  const totalSellSol = history.reduce((acc, t) => acc + (t.sellAmountSol || 0), 0);
  const netPnlSol = totalSellSol - totalBuySol;
  const winTrades = history.filter(t => t.pnlSol >= 0);
  const winRate = history.length > 0 ? (winTrades.length / history.length) * 100 : 0;

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Jupiter Trade History ({history.length})
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[10px] text-slate-400">
            Win Rate: <strong className="text-emerald-400">{winRate.toFixed(0)}%</strong> | Net PnL: <strong className={netPnlSol >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{netPnlSol.toFixed(4)} SOL</strong>
          </div>
          <button
            onClick={clearHistory}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] uppercase font-bold transition-all cursor-pointer"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase">
              <th className="pb-2.5 font-medium">Token</th>
              <th className="pb-2.5 font-medium">Mode</th>
              <th className="pb-2.5 font-medium">Entry</th>
              <th className="pb-2.5 font-medium">Exit</th>
              <th className="pb-2.5 font-medium">PnL</th>
              <th className="pb-2.5 font-medium">Reason</th>
              <th className="pb-2.5 font-medium text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {history.map((trade) => {
              const isProfit = trade.pnlSol >= 0;
              return (
                <tr key={trade.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 font-bold text-white">
                    <div className="flex items-center gap-1.5">
                      <span>{trade.symbol}</span>
                    </div>
                  </td>
                  <td className="py-3">
                    <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${trade.mode === 'REAL' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}`}>
                      {trade.mode}
                    </span>
                  </td>
                  <td className="py-3 text-slate-300">${trade.entryPrice.toFixed(6)}</td>
                  <td className="py-3 text-slate-300">${trade.exitPrice.toFixed(6)}</td>
                  <td className="py-3">
                    <span className={`font-bold flex items-center gap-1 ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {isProfit ? '+' : ''}{trade.pnlPct.toFixed(2)}% ({trade.pnlSol.toFixed(4)} SOL)
                    </span>
                  </td>
                  <td className="py-3 text-slate-400 text-[11px]">{trade.exitReason}</td>
                  <td className="py-3 text-right text-[10px] text-slate-500">
                    {new Date(trade.sellTime).toLocaleTimeString()}
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
