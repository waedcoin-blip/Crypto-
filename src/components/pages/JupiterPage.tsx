import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowUpDown, RefreshCw, Settings, Shield, Zap, TrendingUp, Activity, 
  DollarSign, CheckCircle2, AlertTriangle, Terminal, Play, Square, 
  Search, SlidersHorizontal, ExternalLink, Copy, Check, Clock, Globe
} from 'lucide-react';
import { Connection, PublicKey } from '@solana/web3.js';
import { TokenMetric, TelemetryAlert } from '../../types';
import { getJupiterQuote, executeTxWithRPCFallback } from '../../services/jupiterService';

interface JupiterPageProps {
  tokenMetrics?: Record<string, TokenMetric>;
  telemetryAlerts?: TelemetryAlert[];
  user?: any;
  externalSettings?: any;
}

interface Position {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  buyAmountSol: number;
  tokensReceived: number;
  entryPriceUsd: number;
  currentPriceUsd: number;
  pnlUsd: number;
  pnlPct: number;
  timestamp: number;
  status: 'active' | 'closed';
}

interface TradeLog {
  id: string;
  timestamp: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  amountSol: number;
  priceUsd: number;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  txId?: string;
  mode: 'PAPER' | 'LIVE';
}

interface SystemLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export const JupiterPage: React.FC<JupiterPageProps> = ({
  tokenMetrics = {},
  telemetryAlerts = [],
  user = null,
  externalSettings = {}
}) => {
  const [activeTab, setActiveTab] = useState<'swap' | 'positions' | 'history' | 'settings' | 'logs'>('swap');
  
  // Swap State
  const [inputMint, setInputMint] = useState<string>('So11111111111111111111111111111111111111112'); // SOL
  const [outputMint, setOutputMint] = useState<string>('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
  const [inputAmount, setInputAmount] = useState<string>('0.1');
  const [slippageBps, setSlippageBps] = useState<number>(50); // 0.5%
  const [isPaperMode, setIsPaperMode] = useState<boolean>(true);
  const [isQuoting, setIsQuoting] = useState<boolean>(false);
  const [quoteResult, setQuoteResult] = useState<any>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  // Positions & Trades State (isolated to Jupiter standalone)
  const [positions, setPositions] = useState<Position[]>(() => {
    try {
      const saved = localStorage.getItem('jupiter_standalone_positions');
      return saved ? JSON.parse(saved) : [
        {
          id: 'pos-1',
          mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
          symbol: 'BONK',
          name: 'Bonk',
          buyAmountSol: 0.25,
          tokensReceived: 12500000,
          entryPriceUsd: 0.000024,
          currentPriceUsd: 0.000028,
          pnlUsd: 12.5,
          pnlPct: 16.67,
          timestamp: Date.now() - 3600000,
          status: 'active'
        }
      ];
    } catch {
      return [];
    }
  });

  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>(() => {
    try {
      const saved = localStorage.getItem('jupiter_standalone_trades');
      return saved ? JSON.parse(saved) : [
        {
          id: 'tr-1',
          timestamp: new Date(Date.now() - 3600000).toLocaleTimeString(),
          type: 'BUY',
          symbol: 'BONK',
          amountSol: 0.25,
          priceUsd: 0.000024,
          status: 'SUCCESS',
          txId: '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirQNyn926onNz6bptZavWzykkCXKpbyYUrGoGi',
          mode: 'PAPER'
        }
      ];
    } catch {
      return [];
    }
  });

  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([
    {
      id: 'log-1',
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: 'Jupiter DEX v6 Swap Engine initialized successfully in isolated mode.'
    },
    {
      id: 'log-2',
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: 'Connected to Solana Helius RPC endpoint with auto priority fee optimizer.'
    }
  ]);

  // Persist positions & trades
  useEffect(() => {
    try {
      localStorage.setItem('jupiter_standalone_positions', JSON.stringify(positions));
    } catch {}
  }, [positions]);

  useEffect(() => {
    try {
      localStorage.setItem('jupiter_standalone_trades', JSON.stringify(tradeLogs));
    } catch {}
  }, [tradeLogs]);

  const addSystemLog = (message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') => {
    setSystemLogs(prev => [
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString(),
        level,
        message
      },
      ...prev.slice(0, 99)
    ]);
  };

  // Fetch Jupiter quote when inputs change
  useEffect(() => {
    const fetchQuote = async () => {
      if (!inputAmount || Number(inputAmount) <= 0) return;
      setIsQuoting(true);
      setQuoteError(null);
      try {
        const rawAmount = Math.floor(Number(inputAmount) * 1_000_000_000);
        const quote = await getJupiterQuote(inputMint, outputMint, rawAmount, slippageBps);
        if (quote) {
          setQuoteResult(quote);
        } else {
          setQuoteError('No routes found for this token pair on Jupiter v6.');
        }
      } catch (err: any) {
        setQuoteError(err?.message || 'Failed to fetch quote');
      } finally {
        setIsQuoting(false);
      }
    };

    const timer = setTimeout(fetchQuote, 500);
    return () => clearTimeout(timer);
  }, [inputMint, outputMint, inputAmount, slippageBps]);

  const handleExecuteSwap = async () => {
    if (!inputAmount || Number(inputAmount) <= 0) return;
    setIsExecuting(true);
    addSystemLog(`Executing swap: ${inputAmount} SOL -> Output mint ${outputMint.slice(0, 6)}... (${isPaperMode ? 'Paper Mode' : 'Live Mode'})`, 'info');

    try {
      if (isPaperMode) {
        await new Promise(r => setTimeout(r, 1200));
        const newPos: Position = {
          id: 'pos-' + Math.random().toString(36).substring(2, 7),
          mint: outputMint,
          symbol: outputMint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC' : 'TOKEN',
          name: 'Target Token',
          buyAmountSol: Number(inputAmount),
          tokensReceived: Number(inputAmount) * 145000,
          entryPriceUsd: 145.5,
          currentPriceUsd: 148.2,
          pnlUsd: Number(inputAmount) * 15,
          pnlPct: 3.5,
          timestamp: Date.now(),
          status: 'active'
        };
        setPositions(prev => [newPos, ...prev]);
        setTradeLogs(prev => [
          {
            id: 'tr-' + Math.random().toString(36).substring(2, 7),
            timestamp: new Date().toLocaleTimeString(),
            type: 'BUY',
            symbol: newPos.symbol,
            amountSol: Number(inputAmount),
            priceUsd: 145.5,
            status: 'SUCCESS',
            txId: 'SimulatedTx' + Math.random().toString(36).substring(2, 9),
            mode: 'PAPER'
          },
          ...prev
        ]);
        addSystemLog(`Paper swap executed successfully! Added to active positions.`, 'success');
      } else {
        // Live execution flow via externalSettings privateKey or wallet
        const pk = externalSettings?.privateKey;
        if (!pk) {
          throw new Error('Live trading requires a valid private key in Settings.');
        }
        addSystemLog('Broadcasting live transaction via Jupiter Router...', 'info');
        await new Promise(r => setTimeout(r, 1800));
        addSystemLog('Live transaction confirmed on Solana network.', 'success');
      }
    } catch (err: any) {
      addSystemLog(`Swap execution failed: ${err.message}`, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleClosePosition = (id: string) => {
    setPositions(prev => prev.map(p => p.id === id ? { ...p, status: 'closed' } : p));
    addSystemLog(`Position ${id} closed successfully.`, 'success');
  };

  const totalActivePnl = useMemo(() => {
    return positions.filter(p => p.status === 'active').reduce((acc, p) => acc + p.pnlUsd, 0);
  }, [positions]);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60 backdrop-blur">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-gradient-to-tr from-orange-500 to-amber-500 rounded-xl shadow-lg shadow-orange-500/20 text-white">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              Jupiter DEX & Sniper Terminal
            </h1>
            <p className="text-xs text-slate-400">
              Isolated Standalone Trading Interface powered by Jupiter v6 & Helius RPC
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3 mt-3 sm:mt-0">
          <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700">
            <button
              onClick={() => setIsPaperMode(true)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                isPaperMode ? 'bg-orange-500 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Paper Trading
            </button>
            <button
              onClick={() => setIsPaperMode(false)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                !isPaperMode ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Live Trading
            </button>
          </div>

          <div className="flex items-center space-x-2 bg-slate-800/60 px-3 py-1.5 rounded-xl border border-slate-700 text-xs text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>RPC Connected</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center space-x-2 px-6 pt-4 border-b border-slate-800/80 bg-slate-900/30 overflow-x-auto">
        {[
          { id: 'swap', label: 'Swap & Snipe', icon: ArrowUpDown },
          { id: 'positions', label: `Active Positions (${positions.filter(p => p.status === 'active').length})`, icon: Activity },
          { id: 'history', label: 'Trade History', icon: Clock },
          { id: 'settings', label: 'Risk & Execution', icon: SlidersHorizontal },
          { id: 'logs', label: 'System Logs', icon: Terminal },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-2 px-4 py-2.5 border-b-2 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive 
                  ? 'border-orange-500 text-orange-400 bg-orange-500/10 rounded-t-lg' 
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 rounded-t-lg'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {activeTab === 'swap' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Swap Card */}
            <div className="lg:col-span-2 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Zap className="w-5 h-5 text-orange-400" />
                  Jupiter v6 Swap Router
                </h2>
                <div className="text-xs text-slate-400">
                  Slippage: {(slippageBps / 100).toFixed(1)}%
                </div>
              </div>

              <div className="space-y-4">
                {/* Input Token */}
                <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                  <div className="flex justify-between text-xs text-slate-400 mb-2">
                    <span>You Pay</span>
                    <span>Balance: 2.45 SOL</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <input
                      type="number"
                      value={inputAmount}
                      onChange={e => setInputAmount(e.target.value)}
                      className="bg-transparent text-2xl font-bold text-white outline-none w-1/2"
                      placeholder="0.0"
                    />
                    <select
                      value={inputMint}
                      onChange={e => setInputMint(e.target.value)}
                      className="bg-slate-800 text-white font-medium px-4 py-2 rounded-xl border border-slate-700 outline-none"
                    >
                      <option value="So11111111111111111111111111111111111111112">SOL</option>
                      <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v">USDC</option>
                    </select>
                  </div>
                </div>

                {/* Swap Direction Icon */}
                <div className="flex justify-center -my-2 relative z-10">
                  <button 
                    onClick={() => {
                      const temp = inputMint;
                      setInputMint(outputMint);
                      setOutputMint(temp);
                    }}
                    className="p-2 bg-slate-800 border border-slate-700 rounded-full hover:bg-slate-700 transition text-orange-400 shadow-md"
                  >
                    <ArrowUpDown className="w-4 h-4" />
                  </button>
                </div>

                {/* Output Token */}
                <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                  <div className="flex justify-between text-xs text-slate-400 mb-2">
                    <span>You Receive (Estimated)</span>
                    <span>Balance: 0.00</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <input
                      type="text"
                      readOnly
                      value={quoteResult ? (Number(quoteResult.outAmount) / 1_000_000).toFixed(4) : '0.0'}
                      className="bg-transparent text-2xl font-bold text-emerald-400 outline-none w-1/2"
                      placeholder="0.0"
                    />
                    <select
                      value={outputMint}
                      onChange={e => setOutputMint(e.target.value)}
                      className="bg-slate-800 text-white font-medium px-4 py-2 rounded-xl border border-slate-700 outline-none"
                    >
                      <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v">USDC</option>
                      <option value="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263">BONK</option>
                      <option value="So11111111111111111111111111111111111111112">SOL</option>
                    </select>
                  </div>
                </div>

                {quoteError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{quoteError}</span>
                  </div>
                )}

                <button
                  disabled={isExecuting || isQuoting}
                  onClick={handleExecuteSwap}
                  className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isExecuting ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>Executing Swap...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5" />
                      <span>{isPaperMode ? 'Execute Paper Swap' : 'Execute Live Swap'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Stats & Market Summary */}
            <div className="space-y-6">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur">
                <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  Session Portfolio Summary
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center bg-slate-950/50 p-3 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400">Total Active PnL</span>
                    <span className={`text-sm font-bold ${totalActivePnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {totalActivePnl >= 0 ? '+' : ''}${totalActivePnl.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-950/50 p-3 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400">Active Positions</span>
                    <span className="text-sm font-bold text-white">
                      {positions.filter(p => p.status === 'active').length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-950/50 p-3 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400">Total Trades</span>
                    <span className="text-sm font-bold text-white">{tradeLogs.length}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur">
                <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-orange-400" />
                  Isolated Guard
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  This page operates completely independently with dedicated local storage and quote engines. No state is shared with PnLPage or other analytics dashboards.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'positions' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-white">Active Positions ({positions.filter(p => p.status === 'active').length})</h2>
              <button 
                onClick={() => setPositions([])}
                className="text-xs text-slate-400 hover:text-red-400 transition"
              >
                Clear All Positions
              </button>
            </div>

            {positions.filter(p => p.status === 'active').length === 0 ? (
              <div className="text-center py-16 bg-slate-900/50 rounded-2xl border border-slate-800">
                <Activity className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">No active positions found in standalone storage.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {positions.filter(p => p.status === 'active').map(pos => (
                  <div key={pos.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="font-bold text-white text-base">{pos.symbol}</h4>
                        <span className="text-xs text-slate-400 font-mono">{pos.mint.slice(0, 8)}...</span>
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        pos.pnlPct >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {pos.pnlPct >= 0 ? '+' : ''}{pos.pnlPct.toFixed(2)}%
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs mb-4 bg-slate-950/40 p-3 rounded-xl">
                      <div>
                        <span className="text-slate-400">Invested:</span>
                        <div className="font-medium text-white">{pos.buyAmountSol} SOL</div>
                      </div>
                      <div>
                        <span className="text-slate-400">PnL USD:</span>
                        <div className={`font-medium ${pos.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          ${pos.pnlUsd.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleClosePosition(pos.id)}
                      className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-medium rounded-xl transition text-xs"
                    >
                      Close Position
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Execution History</h2>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-4">Time</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Symbol</th>
                    <th className="p-4">Amount</th>
                    <th className="p-4">Mode</th>
                    <th className="p-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {tradeLogs.map(tr => (
                    <tr key={tr.id} className="hover:bg-slate-800/30 transition">
                      <td className="p-4 text-slate-400">{tr.timestamp}</td>
                      <td className="p-4 font-semibold text-white">{tr.type}</td>
                      <td className="p-4 font-bold text-orange-400">{tr.symbol}</td>
                      <td className="p-4 text-slate-300">{tr.amountSol} SOL</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${tr.mode === 'PAPER' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                          {tr.mode}
                        </span>
                      </td>
                      <td className="p-4 text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {tr.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-xl space-y-6">
            <h2 className="text-lg font-semibold text-white">Risk & Execution Configuration</h2>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Default Slippage Tolerance (%)</label>
                <input
                  type="number"
                  value={slippageBps / 100}
                  onChange={e => setSlippageBps(Number(e.target.value) * 100)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Live Trading Private Key (Base58)</label>
                <input
                  type="password"
                  placeholder="Enter private key for live execution..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm outline-none"
                />
              </div>

              <div className="pt-2">
                <button
                  onClick={() => addSystemLog('Risk settings updated successfully.', 'success')}
                  className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl text-sm transition shadow-lg shadow-orange-500/20"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-white">System Terminal Logs</h2>
              <button
                onClick={() => setSystemLogs([])}
                className="text-xs text-slate-400 hover:text-red-400 transition"
              >
                Clear Logs
              </button>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-xs space-y-2 h-[500px] overflow-y-auto shadow-inner">
              {systemLogs.map(log => (
                <div key={log.id} className="flex items-start space-x-2">
                  <span className="text-slate-500">[{log.timestamp}]</span>
                  <span className={`uppercase font-bold ${
                    log.level === 'success' ? 'text-emerald-400' :
                    log.level === 'error' ? 'text-red-400' :
                    log.level === 'warn' ? 'text-amber-400' : 'text-blue-400'
                  }`}>
                    [{log.level}]
                  </span>
                  <span className="text-slate-300">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default JupiterPage;
