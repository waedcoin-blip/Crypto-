import React, { useState } from 'react';
import { Loader2, Zap, AlertTriangle } from 'lucide-react';
import { useTradingActions } from '../hooks/useTradingActions';
import { useAppStore } from '../store/appStore';

interface TradeExecutionPanelProps {
  mint: string;
  symbol: string;
  network: string;
  defaultAmountSol?: number;
}

export function TradeExecutionPanel({ mint, symbol, network, defaultAmountSol = 0.1 }: TradeExecutionPanelProps) {
  const [amountSol, setAmountSol] = useState(defaultAmountSol);
  const { executeBuy, executeSell, isBuying, isSelling, lastError } = useTradingActions();
  const addLog = useAppStore(state => state.addLog);

  const handleBuy = async () => {
    addLog?.(`🟡 [UI] Requesting BUY for ${symbol} (${amountSol} SOL) via backend...`, 'info');
    const res = await executeBuy({
      network,
      mint,
      amountSol,
      slippageBps: 250, // 2.5%
      tpPct: 25,
      slPct: 15,
    });
    
    if (res.success) {
      addLog?.(`✅ [UI] Backend confirmed BUY for ${symbol}. Order: ${res.orderId}`, 'success');
    }
  };

  const handleSell = async () => {
    addLog?.(`🟡 [UI] Requesting SELL for ${symbol} via backend...`, 'info');
    const res = await executeSell({ network, mint });
    
    if (res.success) {
      addLog?.(`✅ [UI] Backend confirmed SELL for ${symbol}. Sig: ${res.signature?.slice(0, 12)}...`, 'success');
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 bg-[#0f111a] border border-[#2d2e3d] rounded-xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">{symbol} Execution</h3>
        <span className="text-[10px] text-[#64748b] font-mono">{mint.slice(0, 4)}...{mint.slice(-4)}</span>
      </div>

      <div className="flex gap-2">
        <input
          type="number"
          step="0.01"
          value={amountSol}
          onChange={(e) => setAmountSol(parseFloat(e.target.value) || 0)}
          className="w-24 bg-[#050509] border border-[#2d2e3d] rounded px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-[#c7f284]"
          placeholder="SOL"
        />
        <button
          onClick={handleBuy}
          disabled={isBuying || isSelling || amountSol <= 0}
          className="flex-1 flex items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold py-1.5 rounded transition-all disabled:opacity-50 cursor-pointer"
        >
          {isBuying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          SERVER BUY
        </button>
        <button
          onClick={handleSell}
          disabled={isBuying || isSelling}
          className="flex-1 flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold py-1.5 rounded transition-all disabled:opacity-50 cursor-pointer"
        >
          {isSelling ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
          SERVER SELL
        </button>
      </div>

      {lastError && (
        <div className="text-[10px] text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded p-2 font-mono">
          ⚠️ {lastError}
        </div>
      )}
    </div>
  );
}
