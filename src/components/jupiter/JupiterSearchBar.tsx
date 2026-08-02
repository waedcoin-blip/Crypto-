import React from 'react';
import { Search, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { JupiterTokenMetadata } from '../../services/jupiter/tokenSearchService';

interface JupiterSearchBarProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onSearch: () => void;
  loading: boolean;
  error: string | null;
  loadedCount: number;
  hasProfitableHistory: boolean;
}

export const JupiterSearchBar: React.FC<JupiterSearchBarProps> = ({
  searchQuery,
  setSearchQuery,
  onSearch,
  loading,
  error,
  loadedCount,
  hasProfitableHistory,
}) => {
  return (
    <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-3">
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="Search token by symbol, name, or paste mint address..."
            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                onSearch();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        <button
          onClick={onSearch}
          disabled={loading}
          className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 disabled:opacity-50 shrink-0 cursor-pointer shadow-lg shadow-indigo-600/20"
        >
          {loading ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Searching...</span>
            </>
          ) : (
            <>
              <Search className="w-3.5 h-3.5" />
              <span>Find Token</span>
            </>
          )}
        </button>
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1 border-t border-slate-800/40">
        <div className="flex items-center gap-2">
          {hasProfitableHistory ? (
            <span className="flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full text-[10px] font-semibold">
              <CheckCircle2 className="w-3 h-3" />
              {loadedCount} Profitable Token{loadedCount !== 1 ? 's' : ''} Received
            </span>
          ) : (
            <span className="text-slate-500">
              No profitable token history provided. Manual search active.
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full text-[10px]">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[300px]">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};
