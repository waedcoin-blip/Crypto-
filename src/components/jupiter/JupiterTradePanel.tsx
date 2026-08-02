import React, { useState, useEffect, useCallback } from 'react';
import { 
  Zap, 
  ArrowDownUp, 
  RefreshCw, 
  ShieldCheck, 
  ExternalLink, 
  Check, 
  AlertTriangle,
  Sliders,
  DollarSign
} from 'lucide-react';
import { JupiterTokenMetadata } from '../../services/jupiter/tokenSearchService';
import { fetchJupiterQuoteService, JupiterQuoteInfo } from '../../services/jupiter/quoteService';
import { 
  createJupiterSwapTransaction, 
  executeTxWithRPCFallback, 
  pingJupiterApi 
} from '../../services/jupiter/jupiterService';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

interface JupiterTradePanelProps {
  token: JupiterTokenMetadata | null;
}

export const JupiterTradePanel: React.FC<JupiterTradePanelProps> = ({ token }) => {
  const [tradeMode, setTradeMode] = useState<'BUY' | 'SELL'>('BUY');
  const [amountSol, setAmountSol] = useState('0.1');
  const [slippageBps, setSlippageBps] = useState(100); // 1%
  const [quote, setQuote] = useState<JupiterQuoteInfo | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [tradeMessage, setTradeMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [apiStatus, setApiStatus] = useState<{ healthy: boolean; pingMs: number } | null>(null);

  // Independent simulator balance state stored in isolated key
  const [simBalanceSol, setSimBalanceSol] = useState<number>(() => {
    const saved = localStorage.getItem('jupiter_standalone_simBalance');
    return saved ? parseFloat(saved) : 10.0;
  });

  // Check Jupiter API health on mount
  useEffect(() => {
    pingJupiterApi().then(status => setApiStatus({ healthy: status.healthy, pingMs: status.pingMs }));
  }, []);

  // Fetch quote whenever token, trade mode, or amount changes
  const handleGetQuote = useCallback(async () => {
    if (!token || !token.address) return;

    setLoadingQuote(true);
    setTradeMessage(null);

    const isBuy = tradeMode === 'BUY';
    const inputMint = isBuy ? SOL_MINT : token.address;
    const outputMint = isBuy ? token.address : SOL_MINT;

    const parsedNum = parseFloat(amountSol);
    if (isNaN(parsedNum) || parsedNum <= 0) {
      setLoadingQuote(false);
      setQuote(null);
      return;
    }

    const lamports = isBuy
      ? Math.floor(parsedNum * 1_000_000_000)
      : Math.floor(parsedNum * Math.pow(10, token.decimals || 6));

    const quoteRes = await fetchJupiterQuoteService(inputMint, outputMint, lamports, slippageBps);
    setQuote(quoteRes);
    setLoadingQuote(false);
  }, [token, tradeMode, amountSol, slippageBps]);

  useEffect(() => {
    handleGetQuote();
  }, [handleGetQuote]);

  const handleExecuteSwap = async () => {
    if (!token || !token.address) return;

    setExecuting(true);
    setTradeMessage(null);

    try {
      const isBuy = tradeMode === 'BUY';
      const parsedAmount = parseFloat(amountSol);

      if (isBuy) {
        if (parsedAmount > simBalanceSol) {
          setTradeMessage({ type: 'error', text: 'Insufficient SOL simulation balance' });
          setExecuting(false);
          return;
        }

        const newBal = simBalanceSol - parsedAmount;
        setSimBalanceSol(newBal);
        localStorage.setItem('jupiter_standalone_simBalance', newBal.toString());

        // Save trade to Jupiter standalone history
        const savedHistory = JSON.parse(localStorage.getItem('jupiter_standalone_tradeHistory') || '[]');
        const newTrade = {
          id: Math.random().toString(36).substring(2, 9),
          mint: token.address,
          symbol: token.symbol,
          type: 'BUY',
          amountSol: parsedAmount,
          priceUsd: token.priceUsd,
          timestamp: Date.now()
        };
        savedHistory.unshift(newTrade);
        localStorage.setItem('jupiter_standalone_tradeHistory', JSON.stringify(savedHistory.slice(0, 50)));

        setTradeMessage({
          type: 'success',
          text: `Successfully executed BUY of ${token.symbol} for ${parsedAmount} SOL!`
        });
      } else {
        const solReceived = parsedAmount * (token.priceNativeSol || 0.0001);
        const newBal = simBalanceSol + solReceived;
        setSimBalanceSol(newBal);
        localStorage.setItem('jupiter_standalone_simBalance', newBal.toString());

        const savedHistory = JSON.parse(localStorage.getItem('jupiter_standalone_tradeHistory') || '[]');
        const newTrade = {
          id: Math.random().toString(36).substring(2, 9),
          mint: token.address,
          symbol: token.symbol,
          type: 'SELL',
          amountSol: solReceived,
          priceUsd: token.priceUsd,
          timestamp: Date.now()
        };
        savedHistory.unshift(newTrade);
        localStorage.setItem('jupiter_standalone_tradeHistory', JSON.stringify(savedHistory.slice(0, 50)));

        setTradeMessage({
          type: 'success',
          text: `Successfully executed SELL of ${token.symbol} receiving ~${solReceived.toFixed(4)} SOL!`
        });
      }
    } catch (e: any) {
      setTradeMessage({
        type: 'error',
        text: `Execution error: ${e?.message || e}`
      });
    } finally {
      setExecuting(false);
    }
  };

  if (!token) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-3">
        <Zap className="w-8 h-8 text-indigo-400" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Select a Token to Trade</h3>
        <p className="text-xs text-slate-400 max-w-xs font-mono">
          Pick any token from the list or search for a custom mint to view quotes and swap.
        </p>
      </div>
    );
  }

  const outputTokens = quote
    ? tradeMode === 'BUY'
      ? (Number(quote.outAmount) / Math.pow(10, token.decimals || 6)).toLocaleString()
      : (Number(quote.outAmount) / 1_000_000_000).toFixed(4)
    : '0';

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 shadow-2xl space-y-4 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">Jupiter Swap Terminal</span>
        </div>

        {apiStatus && (
          <span className={`text-[10px] px-2.5 py-1 rounded-full border ${apiStatus.healthy ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
            {apiStatus.healthy ? `API Active (${apiStatus.pingMs}ms)` : 'API Offline'}
          </span>
        )}
      </div>

      {/* Selected Token Info */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {token.logoURI ? (
            <img src={token.logoURI} alt={token.symbol} className="w-9 h-9 rounded-full border border-slate-700" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-bold text-xs">
              {token.symbol.slice(0, 2)}
            </div>
          )}
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              {token.symbol}
              <span className="text-[10px] text-slate-500 font-normal">({token.name})</span>
            </div>
            <div className="text-[11px] text-slate-400">
              ${token.priceUsd ? token.priceUsd.toFixed(8) : '0.00'} USD
            </div>
          </div>
        </div>

        <div className="text-right">
          <span className="text-[9px] text-slate-500 uppercase block">Sim Wallet Balance</span>
          <span className="text-xs font-bold text-indigo-400">{simBalanceSol.toFixed(3)} SOL</span>
        </div>
      </div>

      {/* Buy / Sell Toggle */}
      <div className="grid grid-cols-2 gap-2 bg-slate-950/90 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setTradeMode('BUY')}
          className={`py-2 rounded-lg text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            tradeMode === 'BUY'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Buy {token.symbol}
        </button>
        <button
          onClick={() => setTradeMode('SELL')}
          className={`py-2 rounded-lg text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            tradeMode === 'SELL'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Sell {token.symbol}
        </button>
      </div>

      {/* Input Controls */}
      <div className="space-y-3">
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-widest block mb-1">
            {tradeMode === 'BUY' ? 'Amount SOL to Pay' : `Amount ${token.symbol} to Sell`}
          </label>
          <div className="relative">
            <input
              type="number"
              step="any"
              value={amountSol}
              onChange={(e) => setAmountSol(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-bold">
              {tradeMode === 'BUY' ? 'SOL' : token.symbol}
            </span>
          </div>
        </div>

        {/* Slippage preset buttons */}
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-slate-500 uppercase">Slippage Tolerance:</span>
          <div className="flex items-center gap-1">
            {[50, 100, 300, 500].map((bps) => (
              <button
                key={bps}
                onClick={() => setSlippageBps(bps)}
                className={`px-2 py-0.5 rounded border transition-all ${
                  slippageBps === bps
                    ? 'bg-indigo-600 text-white border-indigo-500 font-bold'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                }`}
              >
                {bps / 100}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Quote Summary */}
      <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 space-y-2 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Estimated Output:</span>
          <span className="text-white font-bold">
            {loadingQuote ? (
              <RefreshCw className="w-3 h-3 animate-spin inline text-indigo-400" />
            ) : (
              `${outputTokens} ${tradeMode === 'BUY' ? token.symbol : 'SOL'}`
            )}
          </span>
        </div>

        {quote && (
          <>
            <div className="flex items-center justify-between border-t border-slate-800/40 pt-1.5">
              <span className="text-slate-500">Price Impact:</span>
              <span className={quote.priceImpactPct > 1 ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                {quote.priceImpactPct.toFixed(2)}%
              </span>
            </div>

            {quote.routePlan.length > 0 && (
              <div className="flex items-center justify-between border-t border-slate-800/40 pt-1.5">
                <span className="text-slate-500">Route:</span>
                <span className="text-indigo-300 truncate max-w-[200px]">
                  {quote.routePlan.join(' → ')}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Messages */}
      {tradeMessage && (
        <div className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
          tradeMessage.type === 'success'
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
        }`}>
          {tradeMessage.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{tradeMessage.text}</span>
        </div>
      )}

      {/* Execute Button */}
      <button
        onClick={handleExecuteSwap}
        disabled={executing || loadingQuote}
        className={`w-full py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-xl cursor-pointer ${
          tradeMode === 'BUY'
            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
            : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20'
        } disabled:opacity-50`}
      >
        {executing ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Executing Swap...</span>
          </>
        ) : (
          <>
            <Zap className="w-4 h-4" />
            <span>Execute {tradeMode} via Jupiter</span>
          </>
        )}
      </button>
    </div>
  );
};
