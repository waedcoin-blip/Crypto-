import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Rocket, Layers, Activity, History, Terminal, SlidersHorizontal } from 'lucide-react';
import { useJupiterSearch } from '../../hooks/jupiter/useJupiterSearch';
import { JupiterSearchBar } from '../jupiter/JupiterSearchBar';
import { JupiterTokenList } from '../jupiter/JupiterTokenList';
import { JupiterTradePanel } from '../jupiter/JupiterTradePanel';
import { JupiterActivePositions } from '../jupiter/JupiterActivePositions';
import { JupiterTradeHistory } from '../jupiter/JupiterTradeHistory';
import { JupiterSystemLog } from '../jupiter/JupiterSystemLog';
import { JupiterRiskSettings } from '../jupiter/JupiterRiskSettings';

export const JupiterPage: React.FC = () => {
  const location = useLocation();
  const profitableTokenAddresses: string[] = location.state?.profitableTokenAddresses ?? [];

  const [activeTab, setActiveTab] = useState<'terminal' | 'positions' | 'history' | 'logs' | 'risk'>('terminal');

  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    selectedToken,
    setSelectedToken,
    loading,
    error,
    hasProfitableHistory,
    handleSearch
  } = useJupiterSearch(profitableTokenAddresses);

  const handleClosePosition = (id: string, reason: string) => {
    const saved = localStorage.getItem('jupiter_standalone_positions');
    if (!saved) return;
    try {
      const positions = JSON.parse(saved);
      const pos = positions.find((p: any) => p.id === id);
      if (!pos) return;

      const remaining = positions.filter((p: any) => p.id !== id);
      localStorage.setItem('jupiter_standalone_positions', JSON.stringify(remaining));

      // Add to trade history
      const history = JSON.parse(localStorage.getItem('jupiter_standalone_tradeHistory') || '[]');
      const currentVal = pos.currentPrice * pos.amount;
      const pnlSol = currentVal - pos.solSpent;
      const pnlPct = pos.solSpent > 0 ? (pnlSol / pos.solSpent) * 100 : 0;

      history.unshift({
        id: Math.random().toString(36).substring(2, 9),
        mint: pos.mint,
        symbol: pos.symbol,
        name: pos.name,
        buyTime: pos.openTime,
        sellTime: Date.now(),
        entryPrice: pos.buyPrice,
        exitPrice: pos.currentPrice,
        amount: pos.amount,
        buyAmountSol: pos.solSpent,
        sellAmountSol: currentVal,
        pnlSol,
        pnlPct,
        exitReason: reason,
        mode: pos.mode
      });
      localStorage.setItem('jupiter_standalone_tradeHistory', JSON.stringify(history));

      // Add system log
      const logs = JSON.parse(localStorage.getItem('jupiter_standalone_logs') || '[]');
      logs.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString(),
        level: pnlSol >= 0 ? 'success' : 'warning',
        message: `Position closed for ${pos.symbol} (${reason}). PnL: ${pnlSol.toFixed(4)} SOL (${pnlPct.toFixed(2)}%)`
      });
      localStorage.setItem('jupiter_standalone_logs', JSON.stringify(logs));
    } catch (e) {
      console.error("Error closing position:", e);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100 p-4 md:p-6 space-y-6">
      {/* Jupiter Header */}
      <div className="bg-gradient-to-r from-indigo-950/80 via-slate-900 to-slate-950 border border-indigo-500/30 rounded-2xl p-5 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-lg shadow-indigo-500/10">
            <Rocket className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white tracking-tight uppercase flex items-center gap-2">
              Jupiter Standalone Trading Engine
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                100% Isolated
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Independent automated trading pipeline, quote router, and risk management system.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono flex-wrap">
          <button
            onClick={() => setActiveTab('terminal')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'terminal' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
          >
            <Layers className="w-3.5 h-3.5" /> Terminal
          </button>
          <button
            onClick={() => setActiveTab('positions')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'positions' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
          >
            <Activity className="w-3.5 h-3.5" /> Active Positions
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'history' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
          >
            <History className="w-3.5 h-3.5" /> History
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'logs' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
          >
            <Terminal className="w-3.5 h-3.5" /> System Log
          </button>
          <button
            onClick={() => setActiveTab('risk')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'risk' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> Risk Config
          </button>
        </div>
      </div>

      {/* Conditional View Rendering */}
      {activeTab === 'terminal' && (
        <div className="space-y-6 animate-in fade-in-50 duration-300">
          {/* Search Bar */}
          <JupiterSearchBar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onSearch={() => handleSearch()}
            loading={loading}
            error={error}
            loadedCount={searchResults.length}
            hasProfitableHistory={hasProfitableHistory}
          />

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 space-y-4">
              <JupiterTokenList
                tokens={searchResults}
                selectedToken={selectedToken}
                onSelectToken={setSelectedToken}
                loading={loading}
              />
            </div>
            <div className="lg:col-span-5 sticky top-4">
              <JupiterTradePanel token={selectedToken} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'positions' && (
        <div className="animate-in fade-in-50 duration-300">
          <JupiterActivePositions onClosePosition={handleClosePosition} />
        </div>
      )}

      {activeTab === 'history' && (
        <div className="animate-in fade-in-50 duration-300">
          <JupiterTradeHistory />
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="animate-in fade-in-50 duration-300">
          <JupiterSystemLog />
        </div>
      )}

      {activeTab === 'risk' && (
        <div className="animate-in fade-in-50 duration-300">
          <JupiterRiskSettings />
        </div>
      )}
    </div>
  );
};
