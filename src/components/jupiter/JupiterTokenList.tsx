import React from 'react';
import { TrendingUp, TrendingDown, ExternalLink, ShieldCheck, Zap } from 'lucide-react';
import { JupiterTokenMetadata } from '../../services/jupiter/tokenSearchService';

interface JupiterTokenListProps {
  tokens: JupiterTokenMetadata[];
  selectedToken: JupiterTokenMetadata | null;
  onSelectToken: (token: JupiterTokenMetadata) => void;
  loading: boolean;
}

export const JupiterTokenList: React.FC<JupiterTokenListProps> = ({
  tokens,
  selectedToken,
  onSelectToken,
  loading
}) => {
  if (loading && tokens.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center text-center space-y-3">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-400 font-mono">Loading token metadata...</p>
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-2">
        <Zap className="w-8 h-8 text-slate-600" />
        <p className="text-xs text-slate-400 font-mono">No tokens found in current search.</p>
        <p className="text-[11px] text-slate-500 max-w-sm">
          No profitable token history available. Use the search box to load a token manually.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-2 text-[10px] font-mono uppercase tracking-widest text-slate-500">
        <span>Available Tokens ({tokens.length})</span>
        <span>Click token to trade</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {tokens.map((token) => {
          const isSelected = selectedToken?.address === token.address;
          const isUp = token.priceChange5m >= 0;

          return (
            <div
              key={token.address}
              onClick={() => onSelectToken(token)}
              className={`group relative p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                isSelected
                  ? 'bg-indigo-950/40 border-indigo-500/80 shadow-lg shadow-indigo-500/10'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {token.logoURI ? (
                    <img
                      src={token.logoURI}
                      alt={token.symbol}
                      className="w-8 h-8 rounded-full border border-slate-700 object-cover shrink-0"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-indigo-400 text-xs font-black shrink-0 font-mono">
                      {token.symbol.slice(0, 2).toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-white tracking-wide truncate">
                        {token.symbol}
                      </span>
                      {token.isProfitableHistory && (
                        <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 rounded font-mono font-semibold">
                          PROFIT
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 truncate block">
                      {token.name}
                    </span>
                  </div>
                </div>

                <a
                  href={`https://dexscreener.com/solana/${token.address}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-slate-500 hover:text-indigo-400 transition-colors p-1"
                  title="View on DexScreener"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60 text-[11px] font-mono">
                <div>
                  <span className="text-[9px] text-slate-500 uppercase block">Price USD</span>
                  <span className="text-white font-medium">
                    ${token.priceUsd ? token.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '0.00'}
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[9px] text-slate-500 uppercase block">5m Change</span>
                  <span className={`font-semibold flex items-center justify-end gap-0.5 ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {token.priceChange5m > 0 ? '+' : ''}{token.priceChange5m.toFixed(2)}%
                  </span>
                </div>

                <div>
                  <span className="text-[9px] text-slate-500 uppercase block">Liquidity</span>
                  <span className="text-slate-300">
                    ${token.liquidityUsd ? Math.round(token.liquidityUsd).toLocaleString() : '0'}
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[9px] text-slate-500 uppercase block">24h Vol</span>
                  <span className="text-slate-300">
                    ${token.volume24h ? Math.round(token.volume24h).toLocaleString() : '0'}
                  </span>
                </div>
              </div>

              {isSelected && (
                <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-indigo-500 rounded-full border-2 border-slate-950 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-white rounded-full" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
