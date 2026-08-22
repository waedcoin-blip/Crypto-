// src/components/DevnetTokenGeneratorModal.tsx
import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  RefreshCw,
  Coins,
  ExternalLink,
  Copy,
  Check,
  Zap,
  Layers,
  ArrowRight,
  TrendingUp,
  X,
  Droplet,
} from 'lucide-react';
import { devnetTokenApi, DevnetToken } from '../services/devnetTokenApi';
import { devnetTokenSource } from '../services/devnetTokenSource';
import { useActiveWalletStore } from '../store/activeWalletStore';
import { useBalanceStore } from '../store/balanceStore';
import { walletBalanceService } from '../services/WalletBalanceService';

interface DevnetTokenGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectToken?: (token: DevnetToken) => void;
}

export const DevnetTokenGeneratorModal: React.FC<DevnetTokenGeneratorModalProps> = ({
  isOpen,
  onClose,
  onSelectToken,
}) => {
  const [activeTab, setActiveTab] = useState<'generate' | 'registry'>('generate');
  const [tokens, setTokens] = useState<DevnetToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState<boolean>(false);

  // Form State
  const [name, setName] = useState<string>('Devnet Alpha Token');
  const [symbol, setSymbol] = useState<string>('ALPHA');
  const [curveType, setCurveType] = useState<'bonding_curve' | 'graduated'>('bonding_curve');
  const [realSolReserves, setRealSolReserves] = useState<number>(6.5);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createdResult, setCreatedResult] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Airdrop State
  const [isAirdropping, setIsAirdropping] = useState<boolean>(false);
  const [airdropMessage, setAirdropMessage] = useState<string | null>(null);
  const [copiedMint, setCopiedMint] = useState<string | null>(null);

  const activeWallet = useActiveWalletStore((s) => s.activeWallet);
  const activeAddress = activeWallet?.address || activeWallet?.keypair?.publicKey.toBase58() || '';

  const fetchTokens = async () => {
    setLoadingTokens(true);
    try {
      const list = await devnetTokenApi.getDevnetTokens();
      setTokens(list);
    } catch (e: any) {
      console.warn('Failed to fetch devnet tokens:', e);
    } finally {
      setLoadingTokens(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTokens();
      setCreatedResult(null);
      setErrorMessage(null);
      setAirdropMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !symbol.trim()) {
      setErrorMessage('Please enter both a token name and symbol');
      return;
    }

    setIsCreating(true);
    setErrorMessage(null);
    setCreatedResult(null);

    try {
      const isComplete = curveType === 'graduated';
      const result = await devnetTokenApi.createDevnetToken({
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        decimals: 6,
        initialSupply: 1_000_000_000,
        targetWallet: activeAddress || undefined,
        complete: isComplete,
        virtualSolReserves: isComplete ? 0 : 30,
        realSolReserves: isComplete ? 85 : realSolReserves,
        description: `Devnet-native ${isComplete ? 'Graduated PumpSwap AMM' : 'Pump.fun Bonding Curve'} test token.`,
      });

      setCreatedResult(result);
      // Ingest directly into active source
      devnetTokenSource.notifyNewTokenCreated(result.token);
      await fetchTokens();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create Devnet test token');
    } finally {
      setIsCreating(false);
    }
  };

  const handleAirdrop = async () => {
    if (!activeAddress) {
      setAirdropMessage('No active wallet connected');
      return;
    }

    setIsAirdropping(true);
    setAirdropMessage(null);

    try {
      const res = await devnetTokenApi.requestAirdrop(activeAddress, 1);
      setAirdropMessage(`✅ Airdropped 1.0 SOL! Tx: ${res.signature.slice(0, 8)}...`);
      useBalanceStore.getState().setOnChainBalance({ solBalance: res.newBalanceSol });
      walletBalanceService.refresh(activeAddress);
    } catch (err: any) {
      setAirdropMessage(`⚠️ Airdrop rate limited: ${err.message}`);
    } finally {
      setIsAirdropping(false);
    }
  };

  const copyToClipboard = (text: string, mint: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMint(mint);
    setTimeout(() => setCopiedMint(null), 2000);
  };

  return (
    <div
      id="devnet-token-generator-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-2xl bg-slate-950 border border-cyan-500/40 rounded-2xl shadow-2xl shadow-cyan-950/50 overflow-hidden text-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">Devnet Token Source & Generator</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  Solana Devnet
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Create real test tokens with authentic Pump.fun bonding curves and PumpSwap AMM routes
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Devnet Airdrop Bar */}
        <div className="px-6 py-2.5 bg-cyan-950/30 border-b border-cyan-500/20 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-cyan-300">
            <Droplet className="w-4 h-4 text-cyan-400" />
            <span>Target Wallet:</span>
            <span className="font-mono font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-200">
              {activeAddress ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-6)}` : 'No wallet selected'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {airdropMessage && <span className="text-[11px] text-cyan-300 font-mono">{airdropMessage}</span>}
            <button
              type="button"
              onClick={handleAirdrop}
              disabled={isAirdropping || !activeAddress}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-bold transition-all disabled:opacity-50 cursor-pointer"
            >
              {isAirdropping ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Airdropping...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  <span>Get 1.0 Devnet SOL</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-900/40 px-6 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('generate')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'generate'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate Test Token</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('registry');
              fetchTokens();
            }}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'registry'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Active Devnet Tokens ({tokens.length})</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === 'generate' ? (
            <form onSubmit={handleCreateToken} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Token Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Solana Dev Pump"
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Token Symbol</label>
                  <input
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    placeholder="e.g. PUMP"
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono font-bold focus:outline-none focus:border-cyan-500"
                    required
                  />
                </div>
              </div>

              {/* Route & Curve Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2">AMM Execution & Curve Status</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCurveType('bonding_curve')}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      curveType === 'bonding_curve'
                        ? 'bg-cyan-950/40 border-cyan-400 shadow-md shadow-cyan-950/40'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-cyan-300">Active Bonding Curve</span>
                      <span className="text-[9px] font-mono bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded">
                        complete: false
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Executes authentic Pump.fun buy & sell bonding curve instructions on Devnet.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCurveType('graduated')}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      curveType === 'graduated'
                        ? 'bg-purple-950/40 border-purple-400 shadow-md shadow-purple-950/40'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-purple-300">Graduated (PumpSwap AMM)</span>
                      <span className="text-[9px] font-mono bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">
                        complete: true
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Routes via canonical PumpSwap AMM / Raydium pool for post-graduation swaps.
                    </p>
                  </button>
                </div>
              </div>

              {curveType === 'bonding_curve' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-300">Initial Real SOL Reserves</label>
                    <span className="text-xs font-mono text-cyan-300 font-bold">{realSolReserves} SOL</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="25"
                    step="0.5"
                    value={realSolReserves}
                    onChange={(e) => setRealSolReserves(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-0.5">
                    <span>1.0 SOL (Early Stage)</span>
                    <span>12.5 SOL (Mid Curve)</span>
                    <span>25.0 SOL (Near Grad)</span>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs">
                  {errorMessage}
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isCreating}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-900/30 disabled:opacity-50 cursor-pointer"
              >
                {isCreating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Generating On-Chain Devnet Token & PDAs...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Create & Ingest Devnet Test Token</span>
                  </>
                )}
              </button>

              {/* Created Token Result Card */}
              {createdResult && (
                <div className="p-4 rounded-xl bg-slate-900 border border-emerald-500/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded bg-emerald-500/20 text-emerald-400">
                        <Check className="w-4 h-4" />
                      </div>
                      <span className="font-bold text-emerald-300 text-xs">Test Token Ready for Swaps</span>
                    </div>
                    <a
                      href={createdResult.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
                    >
                      <span>Solscan Devnet</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                    <div className="p-2 rounded bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 text-[10px] block">Mint Address:</span>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-200 truncate font-bold">{createdResult.token.mint}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(createdResult.token.mint, createdResult.token.mint)}
                          className="text-slate-400 hover:text-white p-1"
                        >
                          {copiedMint === createdResult.token.mint ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="p-2 rounded bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 text-[10px] block">Bonding Curve PDA:</span>
                      <span className="text-cyan-300 truncate block font-bold">
                        {createdResult.token.bondingCurve}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (onSelectToken) onSelectToken(createdResult.token);
                        onClose();
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition-all cursor-pointer"
                    >
                      <span>Select Token For Trading</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </form>
          ) : (
            /* Active Devnet Tokens Registry */
            <div className="space-y-3">
              {loadingTokens ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
                  <span className="text-xs">Loading Devnet token registry...</span>
                </div>
              ) : tokens.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-2">
                  <p className="text-xs">No Devnet tokens found.</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('generate')}
                    className="text-xs font-bold text-cyan-400 hover:underline cursor-pointer"
                  >
                    Generate your first test token →
                  </button>
                </div>
              ) : (
                tokens.map((t) => (
                  <div
                    key={t.mint}
                    className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-slate-100 text-sm font-mono">{t.symbol}</span>
                        <span className="text-xs text-slate-400 truncate">{t.name}</span>
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.2 rounded uppercase ${
                            t.complete
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          }`}
                        >
                          {t.complete ? 'PumpSwap' : 'Pump Curve'}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
                        <span>Price: <strong className="text-slate-200">${t.priceUsd ? t.priceUsd.toFixed(8) : '---'}</strong></span>
                        <span>Liq: <strong className="text-slate-200">${t.liquidityUsd ? t.liquidityUsd.toLocaleString() : '---'}</strong></span>
                        <span>MCap: <strong className="text-slate-200">${t.marketCap ? t.marketCap.toLocaleString() : '---'}</strong></span>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 truncate">
                        <span>Mint:</span>
                        <span className="truncate text-slate-400">{t.mint}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(t.mint, t.mint)}
                          className="hover:text-white"
                          title="Copy mint"
                        >
                          {copiedMint === t.mint ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={`https://solscan.io/token/${t.mint}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                        title="View on Solscan Devnet"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          if (onSelectToken) onSelectToken(t);
                          onClose();
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition-all cursor-pointer"
                      >
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>Trade</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs text-slate-400">
          <span>Cluster: <strong className="text-cyan-300 font-mono">Solana Devnet</strong></span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
