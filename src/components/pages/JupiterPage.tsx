import React from 'react';
import { useLocation } from 'react-router-dom';
import { Rocket, RefreshCw, Zap, ShieldAlert, BookOpen, Layers } from 'lucide-react';
import { useJupiterSearch } from '../../hooks/jupiter/useJupiterSearch';
import { JupiterSearchBar } from '../jupiter/JupiterSearchBar';
import { JupiterTokenList } from '../jupiter/JupiterTokenList';
import { JupiterTradePanel } from '../jupiter/JupiterTradePanel';

export const JupiterPage: React.FC = () => {
  const location = useLocation();
  const profitableTokenAddresses: string[] = location.state?.profitableTokenAddresses ?? [];

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
              Jupiter Terminal
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                100% Standalone
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Independent search engine, quote router, and swap executor.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="bg-slate-900/80 border border-slate-800 px-3.5 py-1.5 rounded-xl text-slate-400 flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Loaded: <strong className="text-white">{searchResults.length}</strong> tokens</span>
          </div>
        </div>
      </div>

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
        {/* Token List / Search Engine Results */}
        <div className="lg:col-span-7 space-y-4">
          <JupiterTokenList
            tokens={searchResults}
            selectedToken={selectedToken}
            onSelectToken={setSelectedToken}
            loading={loading}
          />
        </div>

        {/* Swap & Execution Panel */}
        <div className="lg:col-span-5 sticky top-4">
          <JupiterTradePanel token={selectedToken} />
        </div>
      </div>
    </div>
  );
};
