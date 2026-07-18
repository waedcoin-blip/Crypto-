import React, { useState, useEffect } from 'react';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { 
  TrendingUp, 
  Square, 
  Search, 
  Wallet, 
  RefreshCw, 
  AlertTriangle,
  Zap,
  Bookmark,
  Key,
  Eye,
  EyeOff,
  Copy,
  Check
} from 'lucide-react';
import { TokenMetric, SniperTrade } from '../../types';
import { cn, detectTokenStage } from '../../lib/utils';

// Local helper matching the rest of the application
const getDynamicOperationalFeeSol = (isRecovery: boolean = false, tradeAmountSol: number = 0.05): number => {
  const baseGasAndComputeSol = 0.00005;
  let jitoTip = isRecovery ? 0.0025 : 0.0015;
  if (tradeAmountSol < 0.05) {
     jitoTip = isRecovery ? 0.0010 : 0.0003; 
  }
  return baseGasAndComputeSol + jitoTip;
};

interface Position {
  symbol: string;
  buyPrice: number;
  currentPrice: number;
  solSpent: number;
  amount: number;
  amountLamports?: number;
  entryTime: number;
  txid: string;
  recoveryMode?: boolean;
  triggersDisabled?: boolean;
  isScalp?: boolean;
  isStale?: boolean;
  realNetPnl?: number;
  realNetSol?: number;
  simRealBought?: boolean;
  simRealBoughtPriceSol?: number;
  simRealAmountTokens?: number;
  simRealSolSpent?: number;
  simRealBoughtTime?: number;
  simRealIsVirtualFallback?: boolean;
}

interface SimRealPageProps {
  tokenMetrics: Record<string, TokenMetric>;
  positions: Record<string, Position>;
  simRealBalance: number;
  simRealTrades: SniperTrade[];
  maxPositions: number;
  slippage: number;
  privateKey: string;
  setPrivateKey: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  jupiterRpcUrl?: string;
  setJupiterRpcUrl?: (v: string) => void;
  rpcUrl?: string;
  customWsUrl?: string;
  stopLoss: number;
  bondingCurveStopLoss: number;
  pumpSwapStopLoss: number;
  unknownStopLoss: number;
  executeSimRealSell: (mint: string) => Promise<void>;
  resetSimRealWallet: () => void;
  maxRebuyTimes: number;
  setMaxRebuyTimes: (v: number) => void;
  jupiterLogs: { id: string; timestamp: number; type: 'QUOTE' | 'SWAP' | 'ERROR' | 'INFO'; message: string; details?: any }[];
}

export const SimRealPage: React.FC<SimRealPageProps> = ({
  tokenMetrics,
  positions,
  simRealBalance,
  simRealTrades,
  maxPositions,
  slippage,
  privateKey,
  setPrivateKey,
  apiKey,
  setApiKey,
  jupiterRpcUrl = '',
  setJupiterRpcUrl = () => {},
  rpcUrl,
  customWsUrl,
  stopLoss,
  bondingCurveStopLoss,
  pumpSwapStopLoss,
  unknownStopLoss,
  executeSimRealSell,
  resetSimRealWallet,
  maxRebuyTimes,
  setMaxRebuyTimes,
  jupiterLogs
}) => {
  const [showKey, setShowKey] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };
  
  // --- JUPITER WALLET STATUS, BALANCE, & MONITOR ---
  const [jupiterStatus, setJupiterStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'>('DISCONNECTED');
  const [jupiterAddress, setJupiterAddress] = useState<string>('');
  const [jupiterBalance, setJupiterBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!privateKey) {
      setJupiterStatus('DISCONNECTED');
      setJupiterAddress('');
      setJupiterBalance(null);
      return;
    }

    let isMounted = true;
    const checkWallet = async () => {
      try {
        setJupiterStatus('CONNECTING');
        let keypair;
        try {
          keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
        } catch (e) {
          setJupiterStatus('ERROR');
          setJupiterAddress('');
          setJupiterBalance(null);
          return;
        }

        const pubKeyStr = keypair.publicKey.toBase58();
        setJupiterAddress(pubKeyStr);

        const activeRpcUrl = jupiterRpcUrl && jupiterRpcUrl.trim() !== "" ? jupiterRpcUrl.trim() : rpcUrl;
        if (!activeRpcUrl) {
          setJupiterStatus('ERROR');
          return;
        }

        const activeWsUrl = (customWsUrl && customWsUrl.trim() !== "") ? customWsUrl.trim() : activeRpcUrl.replace('https', 'wss').replace('http', 'ws');
        const conn = new Connection(activeRpcUrl, { commitment: 'confirmed', wsEndpoint: activeWsUrl });

        const lamports = await conn.getBalance(keypair.publicKey, 'confirmed');
        const solBal = lamports / 1_000_000_000;

        if (isMounted) {
          setJupiterBalance(solBal);
          setJupiterStatus('CONNECTED');
        }
      } catch (err) {
        if (isMounted) {
          setJupiterStatus('ERROR');
        }
      }
    };

    checkWallet();
    const interval = setInterval(checkWallet, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [privateKey, rpcUrl, jupiterRpcUrl, customWsUrl]);
  
  const activeSimrealPositions = Object.values(positions).filter(pos => pos && pos.simRealBought);

  const getCompletedSimRealTrades = () => {
    const completed: Array<{
      id: string;
      mint: string;
      token: string;
      buyTime: number;
      sellTime: number;
      buyAmountSol: number;
      sellAmountSol: number;
      pnlPct: number;
      tokenAmount?: number;
    }> = [];
    
    // simRealTrades has newest first, so we reverse it to process chronologically
    const chronological = [...simRealTrades].reverse();
    const openBuys: Record<string, Array<{ timestamp: number; amount: number; tokenAmount?: number }>> = {};
    
    for (const trade of chronological) {
      if (trade.type === 'BUY') {
        if (!openBuys[trade.address]) openBuys[trade.address] = [];
        openBuys[trade.address].push({ timestamp: trade.timestamp, amount: trade.amount, tokenAmount: trade.tokenAmount });
      } else if (trade.type === 'SELL') {
        const buy = openBuys[trade.address]?.shift();
        if (buy) {
          completed.push({
            id: trade.id,
            mint: trade.address,
            token: trade.token,
            buyTime: buy.timestamp,
            sellTime: trade.timestamp,
            buyAmountSol: buy.amount,
            sellAmountSol: trade.amount,
            pnlPct: trade.pnl !== undefined ? trade.pnl : ((trade.amount - buy.amount) / buy.amount * 100),
            tokenAmount: buy.tokenAmount || trade.tokenAmount
          });
        } else {
          const estimatedBuySol = trade.pnl !== undefined ? (trade.amount / (1 + trade.pnl / 100)) : (trade.amount / 1.01);
          completed.push({
            id: trade.id,
            mint: trade.address,
            token: trade.token,
            buyTime: trade.timestamp - 60000,
            sellTime: trade.timestamp,
            buyAmountSol: estimatedBuySol,
            sellAmountSol: trade.amount,
            pnlPct: trade.pnl !== undefined ? trade.pnl : 0,
            tokenAmount: trade.tokenAmount
          });
        }
      }
    }
    
    return completed.reverse();
  };

  const completedTrades = getCompletedSimRealTrades();

  const totalBuySol = completedTrades.reduce((sum, t) => sum + t.buyAmountSol, 0);
  const totalSellSol = completedTrades.reduce((sum, t) => sum + t.sellAmountSol, 0);
  const totalProfitSol = totalSellSol - totalBuySol;
  const totalPnlPct = totalBuySol > 0 ? (totalProfitSol / totalBuySol) * 100 : 0;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 lg:space-y-12 w-full h-full overflow-y-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-[#1f212e]">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black uppercase tracking-wider text-emerald-400 flex items-center gap-3">
            <Wallet className="w-8 h-8 text-emerald-400" />
            Simreal Trading Platform
          </h1>
          <p className="text-xs uppercase tracking-widest font-mono text-slate-500 mt-1">
            Simulated Real-Time Copy Trader and Automated Active Wallet Execution
          </p>
        </div>
        
        <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-xl px-4 py-3 flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Simreal Wallet Balance</span>
            <span className="text-lg font-mono font-black text-emerald-400">
              {simRealBalance.toFixed(4)} SOL
            </span>
          </div>
          <button 
            onClick={resetSimRealWallet}
            className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-emerald-500/20 transition-all active:scale-95 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            Reset
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Active Positions */}
        <div className="lg:col-span-5 space-y-4">
          {/* Credentials Configuration Card */}
          <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-2xl flex flex-col p-4 space-y-3">
             <div className="flex flex-col pb-2 border-b border-[#1f212e]">
                <h2 className="text-[12px] uppercase tracking-[1px] text-emerald-400 font-bold flex items-center gap-2">
                   <Key className="w-3.5 h-3.5" />
                   On-Chain Credentials & Limits
                </h2>
                <span className="text-[9px] text-slate-500 uppercase font-mono mt-0.5">Sensitive keys & buy limits used strictly for SimReal active positions</span>
             </div>
             
             <div className="space-y-3">
                <div className="flex flex-col gap-1">
                   <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Jupiter API Key</label>
                   <input
                      type="text"
                      placeholder="Optional. Jupiter premium API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                   />
                </div>

                <div className="flex flex-col gap-1">
                   <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                      <span>Jupiter Custom RPC URL</span>
                      <span className="text-[8px] text-emerald-400 font-normal normal-case">(Fixes Swap Failures)</span>
                   </label>
                   <input
                      type="text"
                      placeholder="Optional. Dedicated RPC for Jupiter swap transactions"
                      value={jupiterRpcUrl}
                      onChange={(e) => setJupiterRpcUrl(e.target.value)}
                      className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                   />
                </div>
                
                <div className="flex flex-col gap-1">
                   <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Wallet Private Key (Base58)</label>
                   <div className="relative">
                      <input
                         type={showKey ? "text" : "password"}
                         placeholder="Optional. Paste your Base58 Private Key to enable real swaps"
                         value={privateKey}
                         onChange={(e) => setPrivateKey(e.target.value)}
                         className="bg-[#07080e] border border-[#1f212e] rounded-lg pl-3 pr-10 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                      />
                      <button
                         type="button"
                         onClick={() => setShowKey(!showKey)}
                         className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                         {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                   </div>
                </div>

                <div className="flex flex-col gap-1">
                   <div className="flex justify-between items-center">
                      <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Max Rebuy Times</label>
                      <span className="text-[9px] text-slate-500 font-mono">Max trades per token</span>
                   </div>
                   <input
                      type="number"
                      min="1"
                      step="1"
                      value={maxRebuyTimes}
                      onChange={(e) => setMaxRebuyTimes(Number(e.target.value))}
                      className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                   />
                </div>

                {privateKey ? (
                   <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-2">
                      <div className="flex items-center gap-2">
                         <div className={`w-1.5 h-1.5 rounded-full ${
                            jupiterStatus === 'CONNECTED' ? 'bg-emerald-400 animate-pulse' :
                            jupiterStatus === 'CONNECTING' ? 'bg-amber-400 animate-pulse' :
                            'bg-rose-400'
                         }`} />
                         <span className="text-[10px] text-emerald-400 font-mono uppercase font-bold">Jupiter Wallet: {jupiterStatus}</span>
                      </div>
                      {jupiterAddress && (
                         <div className="flex justify-between items-center text-[9px] font-mono text-slate-400 pt-1 border-t border-[#1f212e]/50">
                            <span>ADDRESS:</span>
                            <span className="text-slate-200 font-bold">{jupiterAddress.slice(0, 8)}...{jupiterAddress.slice(-8)}</span>
                         </div>
                      )}
                      {jupiterBalance !== null && (
                         <div className="space-y-1">
                            <div className="flex justify-between items-center text-[9px] font-mono text-slate-400">
                               <span>ON-CHAIN BALANCE:</span>
                               <span className="text-[#c7f284] font-black">{jupiterBalance.toFixed(4)} SOL</span>
                            </div>
                            {jupiterBalance === 0 && (
                               <div className="text-[9px] text-amber-400 font-mono flex flex-col gap-1 bg-amber-400/10 px-2 py-1.5 rounded mt-1 border border-amber-400/20">
                                  <div className="font-bold flex items-center gap-1 text-amber-300">
                                     <span>⚠️ TRADING SIMULATION ACTIVE</span>
                                  </div>
                                  <div className="text-[8px] text-slate-300 leading-normal">
                                     On-chain balance is 0.0000 SOL. Reverting to virtual simulation balance ({simRealBalance.toFixed(4)} SOL) to resume copy trading safely.
                                  </div>
                               </div>
                            )}
                         </div>
                      )}
                   </div>
                ) : (
                   <div className="p-3 bg-slate-500/5 border border-slate-500/10 rounded-xl flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                      <span className="text-[10px] text-slate-400 font-mono uppercase">Simulation Only (Dry-Run Mode)</span>
                   </div>
                )}
             </div>
          </div>

          <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-2xl flex flex-col p-4">
            <div className="flex justify-between items-center pb-3 border-b border-[#1f212e] mb-4">
              <div className="flex flex-col">
                <h2 className="text-[12px] uppercase tracking-[1px] text-[#c7f284] font-bold">
                  Simreal Active Positions ({activeSimrealPositions.length}/{maxPositions || '♾️'})
                </h2>
                <span className="text-[9px] text-slate-500 uppercase font-mono mt-0.5">Live Copied Positions Currently Held</span>
              </div>
              <span className="text-[10px] font-mono text-[#c7f284] bg-[#c7f284]/10 px-2 py-0.5 rounded border border-[#c7f284]/20 font-bold animate-pulse">
                {activeSimrealPositions.length} Active
              </span>
            </div>
            
            <div className="space-y-3">
              {activeSimrealPositions.length === 0 ? (
                <div className="bg-[#10111a]/40 border border-[#1f212e] border-dashed rounded-2xl p-12 flex flex-col items-center justify-center text-center text-[#64748b]">
                  <div className="w-12 h-12 rounded-full bg-[#1a1b26] border border-[#2d2e3d] flex items-center justify-center mb-3">
                    <Search className="w-5 h-5 text-[#94a3b8] opacity-50" />
                  </div>
                  <p className="text-[13px] text-[#e2e8f0] font-bold">No active Simreal positions.</p>
                  <p className="text-[12px] opacity-70 mt-1 max-w-xs">Copy trades will appear automatically here as system-check and live sniper targets are detected.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {Object.entries(positions)
                    .filter(([_, pos]) => pos && pos.simRealBought)
                    .map(([mint, pos]) => {
                      const currentPrice = pos.currentPrice || pos.buyPrice || 0;
                      const entryPrice = pos.simRealBoughtPriceSol || pos.buyPrice || 0.000001;
                      const tokensQty = pos.simRealAmountTokens || 0;
                      const spentSol = pos.simRealSolSpent || 0.1;
                      
                      const currentGrossSimReal = currentPrice * tokensQty;
                      let netSimRealIfSold = currentGrossSimReal;
                      if (!privateKey) {
                         const slippageFee = currentGrossSimReal * (slippage / 100);
                         const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
                         netSimRealIfSold = Math.max(0, currentGrossSimReal - slippageFee - opFees);
                      }
                      
                      const pnlFraction = (netSimRealIfSold - spentSol) / spentSol;
                      const pnlPct = pnlFraction;
                      const isPos = pnlPct >= 0;
                      const profitSol = netSimRealIfSold - spentSol;

                      const token = tokenMetrics[mint];
                      const stage = detectTokenStage({
                        address: mint,
                        dexId: token?.dexId,
                        bondingCurveProgress: token?.bondingCurveProgress,
                        isRaydiumListed: token?.isRaydiumListed
                      });
                      
                      let activeSL = stopLoss;
                      if (stage.platform === 'PUMP_FUN' || stage.isBonding) {
                        activeSL = bondingCurveStopLoss;
                      } else if (stage.platform === 'PUMPSWAP') {
                        activeSL = pumpSwapStopLoss;
                      } else if (stage.platform === 'UNKNOWN' || stage.stage === 'UNKNOWN') {
                        activeSL = unknownStopLoss;
                      } else {
                        activeSL = stopLoss;
                      }

                      return (
                        <div key={`simreal-page-${mint}`} className="bg-[#0a0b14] border border-[#1f212e] rounded-xl p-4 grid grid-cols-2 gap-x-2 gap-y-3">
                          <div className="col-span-2 flex items-center gap-2 mb-1 flex-wrap">
                            <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
                              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                            <div className="font-bold text-[14px] text-white flex items-center gap-1.5 flex-wrap">
                              {pos.symbol} <span className="text-[#64748b] text-[12px] font-normal hidden sm:inline">/ SOL</span>
                              
                              {stage.isBonding ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30 whitespace-nowrap">
                                  BONDING {stage.bondingProgress.toFixed(0)}%
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 whitespace-nowrap">
                                  {stage.platform}
                                </span>
                              )}

                              <span className="text-rose-400 text-[9px] whitespace-nowrap bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                                SL: {activeSL}%
                              </span>

                              {stage.isNearMigration && (
                                <span className="text-yellow-400 text-[9px] animate-pulse whitespace-nowrap border border-yellow-400/30 bg-yellow-400/10 px-1.5 py-0.5 rounded">
                                  ⚡ MIGRATING
                                </span>
                              )}
                            </div>
                            
                            <div className="ml-auto text-right font-mono">
                              {pos.isStale ? (
                                <div className="flex flex-col items-end">
                                  <span className="text-amber-500 font-bold text-[13px] animate-pulse">MIGRATING...</span>
                                  <span className="text-[10px] text-[#64748b]">On-Chain Processing</span>
                                </div>
                              ) : (
                                <div className={`text-[14px] font-semibold ${isPos ? 'text-[#c7f284]' : 'text-[#ff4d4d]'}`}>
                                  <div>{isPos ? '+' : ''}{(pnlPct * 100).toFixed(2)}%</div>
                                  <div className="text-[11px] opacity-80">{profitSol >= 0 ? '+' : ''}{profitSol.toFixed(4)} SOL</div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-[#64748b] text-[11px] mb-1 uppercase font-medium">Entry Price</div>
                            <div className="font-mono text-[14px] font-semibold text-[#e2e8f0]">
                              {entryPrice.toFixed(8)} SOL
                            </div>
                            <div className="text-[10px] text-[#64748b] mt-0.5">
                              {tokensQty.toLocaleString(undefined, { maximumFractionDigits: 4 })} tokens for {spentSol.toFixed(4)} SOL
                            </div>
                          </div>

                          <div>
                            <div className="text-[#64748b] text-[11px] mb-1 uppercase font-medium">Current Price</div>
                            <div className="font-mono text-[14px] font-semibold text-[#e2e8f0]">
                              {pos.isStale ? (
                                <span className="text-amber-500 font-bold animate-pulse text-[12px]">STALE</span>
                              ) : (
                                `${currentPrice.toFixed(8)} SOL`
                              )}
                            </div>
                          </div>
                          
                          <div className="col-span-2 pt-2">
                             <button 
                               onClick={() => executeSimRealSell(mint)}
                               className="w-full bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-rose-500/20 group"
                              >
                               <span className="flex items-center justify-center gap-2">
                                  <Square className="w-3 h-3 group-hover:scale-110 transition-transform" />
                                  Emergency Force Exit
                               </span>
                             </button>
                          </div>
                          
                          <div className="col-span-2 flex justify-between items-center pt-2 border-t border-[#1f212e]/60">
                            <div className="text-[#64748b] text-[10px] uppercase font-bold tracking-wider">
                              Buy: <span className="text-[#e2e8f0] ml-1">{new Date(pos.simRealBoughtTime || pos.entryTime).toLocaleTimeString()}</span>
                            </div>
                            <a 
                              href={`https://dexscreener.com/solana/${mint}`}
                              target="_blank"
                              rel="noopener noreferrer" 
                              className="flex items-center gap-1 text-[10px] font-bold text-[#94a3b8] hover:text-indigo-400 uppercase tracking-wider transition-colors"
                            >
                              DexScreener <Search className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
          
          {/* Jupiter System Logs */}
          <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-2xl flex flex-col p-4 mt-6">
            <div className="pb-3 border-b border-[#1f212e] mb-4 flex justify-between items-center">
              <div className="flex flex-col">
                <h2 className="text-[12px] uppercase tracking-[1px] text-indigo-400 font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-indigo-400" />
                  Jupiter System Logs
                </h2>
                <span className="text-[9px] text-slate-500 uppercase font-mono mt-0.5">Real-time RPC & Jupiter Engine Execution Logs</span>
              </div>
            </div>

            <div className="overflow-y-auto max-h-[300px] pr-2 space-y-2 font-mono text-[10px] scrollbar-none">
              {jupiterLogs && jupiterLogs.length === 0 ? (
                <div className="text-center text-[#64748b] py-8 text-[11px]">No system logs recorded yet.</div>
              ) : (
                jupiterLogs?.map((log) => (
                  <div key={log.id} className="bg-[#0a0b14] border border-[#1f212e]/60 rounded-lg p-2.5 flex items-start gap-3 hover:bg-[#1f212e]/20 transition-colors">
                    <span className="text-slate-500 shrink-0 mt-0.5">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit', fractionalSecondDigits: 3 })}
                    </span>
                    <div className="flex flex-col flex-1 gap-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[8px] font-black tracking-wider uppercase",
                          log.type === 'QUOTE' ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                          log.type === 'SWAP' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                          log.type === 'ERROR' ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                          "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                        )}>
                          {log.type}
                        </span>
                        <span className={cn(
                          "font-bold break-words",
                          log.type === 'ERROR' ? "text-rose-400" : "text-slate-300"
                        )}>
                          {log.message}
                        </span>
                      </div>
                      {log.details && (
                        <div className="mt-1 bg-[#05050a] rounded border border-[#1f212e]/50 p-2 overflow-x-auto text-[9px] text-slate-400 break-all whitespace-pre-wrap">
                          {typeof log.details === 'object' ? JSON.stringify(log.details, null, 2) : String(log.details)}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Wallet Trades history */}
        <div className="lg:col-span-7">
          <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-2xl flex flex-col p-4">
            <div className="pb-3 border-b border-[#1f212e] mb-4 flex justify-between items-center">
              <div className="flex flex-col">
                <h2 className="text-[12px] uppercase tracking-[1px] text-emerald-400 font-bold">Simreal Wallet Trades</h2>
                <span className="text-[9px] text-slate-500 uppercase font-mono mt-0.5">Automated Active Positions Copy</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/20 font-bold">
                {completedTrades.length} Completed
              </span>
            </div>

            <div className="overflow-x-auto">
              {completedTrades.length === 0 ? (
                <div className="text-center text-[#64748b] py-12 text-[12px] font-mono">No simreal trades completed yet. Active copy trades will compile here.</div>
              ) : (
                <table className="w-full text-left border-collapse text-[11px] font-mono whitespace-nowrap">
                  <thead>
                    <tr className="text-[#64748b] border-b border-[#1f212e]">
                      <th className="pb-2 font-medium pr-4">Token Address</th>
                      <th className="pb-2 font-medium pr-4">Token Amount</th>
                      <th className="pb-2 font-medium pr-4">Buy Time</th>
                      <th className="pb-2 font-medium pr-4">Hold Time</th>
                      <th className="pb-2 font-medium text-right pr-4">Buy SOL</th>
                      <th className="pb-2 font-medium text-right pr-4">Sell SOL</th>
                      <th className="pb-2 font-medium text-right pr-4">Profit SOL</th>
                      <th className="pb-2 font-medium text-right">PnL (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedTrades.map(trade => {
                      const mintDisplay = trade.mint.length > 12 ? `${trade.mint.slice(0, 6)}...${trade.mint.slice(-6)}` : trade.mint || 'Unknown';
                      const holdMs = trade.sellTime - trade.buyTime;
                      const holdSec = Math.floor(holdMs / 1000) % 60;
                      const holdMin = Math.floor(holdMs / 60000) % 60;
                      const holdHr = Math.floor(holdMs / 3600000);
                      
                      let holdString = '';
                      if (holdHr > 0) holdString += `${holdHr}h `;
                      if (holdMin > 0 || holdHr > 0) holdString += `${holdMin}m `;
                      holdString += `${holdSec}s`;

                      const profitSol = trade.sellAmountSol - trade.buyAmountSol;
                      
                      const formattedTokens = trade.tokenAmount !== undefined 
                        ? `${trade.tokenAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })} tokens`
                        : '—';

                      return (
                        <tr key={trade.id} className="border-b border-[#1f212e]/50 last:border-0 hover:bg-[#1f212e]/30 transition-colors">
                          <td className="py-2.5 text-[#e2e8f0] pr-4">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[#c7f284] font-bold">{trade.token}</span>
                              <button 
                                onClick={() => handleCopy(trade.mint, trade.id)}
                                className="group flex items-center gap-1 bg-[#151622] hover:bg-[#1f212e] text-slate-400 hover:text-white px-1.5 py-0.5 rounded border border-[#1f212e] cursor-pointer transition-all"
                                title="Click to copy full token address"
                              >
                                <span className="text-slate-500 text-[10px] group-hover:text-slate-300 font-mono">
                                  {mintDisplay}
                                </span>
                                {copiedId === trade.id ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-slate-500 group-hover:text-slate-300 opacity-60 group-hover:opacity-100 transition-opacity" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-2.5 text-slate-300 pr-4">
                            {formattedTokens}
                          </td>
                          <td className="py-2.5 text-[#e2e8f0] pr-4">
                            {new Date(trade.buyTime).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5 text-[#e2e8f0] pr-4">
                            {holdString}
                          </td>
                          <td className="py-2.5 text-[#e2e8f0] text-right pr-4">
                            {trade.buyAmountSol.toFixed(4)} SOL
                          </td>
                          <td className="py-2.5 text-[#e2e8f0] text-right pr-4">
                            {trade.sellAmountSol.toFixed(4)} SOL
                          </td>
                          <td className={`py-2.5 text-right pr-4 font-bold ${profitSol >= 0 ? 'text-[#c7f284]' : 'text-[#ff4d4d]'}`}>
                            {profitSol >= 0 ? '+' : ''}{profitSol.toFixed(4)} SOL
                          </td>
                          <td className={`py-2.5 text-right font-bold ${trade.pnlPct >= 0 ? 'text-[#c7f284]' : 'text-[#ff4d4d]'}`}>
                            {trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#1f212e] font-black bg-[#10111a]/80 text-[#e2e8f0]">
                      <td className="py-3 text-left pl-2 text-emerald-400 text-[11px]" colSpan={4}>
                        TOTAL PORTFOLIO PERFORMANCE
                      </td>
                      <td className="py-3 text-[#e2e8f0] text-right pr-4 font-mono">
                        {totalBuySol.toFixed(4)} SOL
                      </td>
                      <td className="py-3 text-[#e2e8f0] text-right pr-4 font-mono">
                        {totalSellSol.toFixed(4)} SOL
                      </td>
                      <td className={`py-3 text-right pr-4 font-mono font-bold ${totalProfitSol >= 0 ? 'text-[#c7f284]' : 'text-[#ff4d4d]'}`}>
                        {totalProfitSol >= 0 ? '+' : ''}{totalProfitSol.toFixed(4)} SOL
                      </td>
                      <td className={`py-3 text-right font-mono font-bold ${totalPnlPct >= 0 ? 'text-[#c7f284]' : 'text-[#ff4d4d]'}`}>
                        {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
