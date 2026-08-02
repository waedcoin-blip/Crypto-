import React, { useState, useEffect } from 'react';
import { SlidersHorizontal, Shield, Zap, Check } from 'lucide-react';

export interface JupiterRiskConfig {
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopEnabled: boolean;
  trailingStopPct: number;
  maxOpenPositions: number;
  positionSizeSol: number;
  tradingMode: 'PAPER' | 'REAL';
  autoRebuy: boolean;
}

export const JupiterRiskSettings: React.FC = () => {
  const [config, setConfig] = useState<JupiterRiskConfig>({
    takeProfitPct: 35,
    stopLossPct: 15,
    trailingStopEnabled: true,
    trailingStopPct: 5,
    maxOpenPositions: 5,
    positionSizeSol: 0.1,
    tradingMode: 'PAPER',
    autoRebuy: false
  });
  const [savedMessage, setSavedMessage] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('jupiter-trading-settings');
    if (saved) {
      try {
        setConfig(JSON.parse(saved));
      } catch {
        // use default
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('jupiter-trading-settings', JSON.stringify(config));
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 2000);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Trading Risk Management
          </span>
        </div>
        {savedMessage && (
          <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-bold">
            <Check className="w-3 h-3" /> Saved
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        {/* Mode Selector */}
        <div className="space-y-1.5">
          <label className="text-slate-400 font-medium text-[11px]">Trading Mode</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setConfig({ ...config, tradingMode: 'PAPER' });
              }}
              className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase transition-all cursor-pointer ${config.tradingMode === 'PAPER' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-800 text-slate-400'}`}
            >
              Paper Trading
            </button>
            <button
              onClick={() => {
                if (window.confirm("Enable REAL trading on Solana network with real funds?")) {
                  setConfig({ ...config, tradingMode: 'REAL' });
                }
              }}
              className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase transition-all cursor-pointer ${config.tradingMode === 'REAL' ? 'bg-amber-600 text-white shadow-lg' : 'bg-slate-800 text-slate-400'}`}
            >
              Real Trading
            </button>
          </div>
        </div>

        {/* Take Profit */}
        <div className="space-y-1.5">
          <label className="text-slate-400 font-medium text-[11px]">Take Profit (%)</label>
          <input
            type="number"
            value={config.takeProfitPct}
            onChange={(e) => setConfig({ ...config, takeProfitPct: parseFloat(e.target.value) || 0 })}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Stop Loss */}
        <div className="space-y-1.5">
          <label className="text-slate-400 font-medium text-[11px]">Stop Loss (%)</label>
          <input
            type="number"
            value={config.stopLossPct}
            onChange={(e) => setConfig({ ...config, stopLossPct: parseFloat(e.target.value) || 0 })}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Position Size */}
        <div className="space-y-1.5">
          <label className="text-slate-400 font-medium text-[11px]">Position Size (SOL)</label>
          <input
            type="number"
            step="0.01"
            value={config.positionSizeSol}
            onChange={(e) => setConfig({ ...config, positionSizeSol: parseFloat(e.target.value) || 0.1 })}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.trailingStopEnabled}
              onChange={(e) => setConfig({ ...config, trailingStopEnabled: e.target.checked })}
              className="rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-0"
            />
            <span>Enable Trailing Stop ({config.trailingStopPct}%)</span>
          </label>
        </div>
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-indigo-600/20"
        >
          Save Risk Config
        </button>
      </div>
    </div>
  );
};
