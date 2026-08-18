import { getKeypairFromPrivateKey, getSavedSessionKeypair, saveSessionKeypair } from '../utils/keypairUtils';
// src/components/WalletStatusWidget.tsx
import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { 
  Wallet, 
  Key, 
  Copy, 
  Check, 
  RefreshCw, 
  LogOut, 
  Flame, 
  Globe,
  ShieldCheck, 
  ChevronDown,
  ExternalLink,
  Sparkles,
  Shield
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useBalanceStore } from '../store/balanceStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { WalletBalanceService } from '../services/WalletBalanceService';
import { cn } from '../lib/utils';

export const WalletStatusWidget: React.FC<{ className?: string }> = ({ className }) => {
  const { publicKey, wallet, disconnect } = useWallet();
  const { connection } = useConnection();
  const { sessionWallet, setSessionWallet } = useAppStore();
  const { network, setNetwork, switching } = useTradingEnvironmentStore();

  const {
    solBalance,
    availableSolBalance,
    reservedSol,
    status,
    lastUpdated
  } = useBalanceStore();

  const [copied, setCopied] = useState(false);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keySuccess, setKeySuccess] = useState('');

  const handleUpdateKeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyError('');
    setKeySuccess('');
    const raw = inputKey.trim();
    if (!raw) {
      setKeyError('Please enter a private key');
      return;
    }
    try {
      const kp = getKeypairFromPrivateKey(raw);
      setSessionWallet(kp);

      useBalanceStore.getState().setWalletAddress(kp.publicKey.toBase58());
      const service = new WalletBalanceService(network);
      service.refresh(kp.publicKey.toBase58());

      setKeySuccess(`Wallet updated! Address: ${kp.publicKey.toBase58().slice(0, 4)}...${kp.publicKey.toBase58().slice(-4)}`);
      setInputKey('');
      setTimeout(() => {
        setKeySuccess('');
        setShowKeyForm(false);
      }, 2000);
    } catch (err: any) {
      setKeyError(err.message || 'Invalid Base58 or JSON private key');
    }
  };

  const [showDropdown, setShowDropdown] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Active address: prioritize connected browser wallet, fallback to session wallet keypair
  const activeAddress = publicKey ? publicKey.toBase58() : sessionWallet ? sessionWallet.publicKey.toBase58() : null;
  const isSessionActive = !publicKey && !!sessionWallet;

  // WalletBalanceService polling for active address
  useEffect(() => {
    if (!activeAddress) {
      useBalanceStore.getState().reset();
      return;
    }

    const service = new WalletBalanceService(network);
    service.start(activeAddress, 5000);

    return () => {
      service.destroy();
    };
  }, [network, activeAddress]);

  const handleManualRefresh = async () => {
    if (!activeAddress) return;
    setIsRefreshing(true);
    try {
      const service = new WalletBalanceService(network);
      await service.refresh(activeAddress);
      service.destroy();
    } catch (e) {
      console.warn('Manual balance refresh error:', e);
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateSessionWallet = () => {
    const kp = Keypair.generate();
    setSessionWallet(kp);
    useBalanceStore.getState().setWalletAddress(kp.publicKey.toBase58());
    const service = new WalletBalanceService(network);
    service.refresh(kp.publicKey.toBase58());
  };

  const handleDisconnectSession = () => {
    setSessionWallet(null);
    useBalanceStore.getState().reset();
  };

  const handleNetworkSwitch = async (target: 'devnet' | 'mainnet') => {
    if (target === network) return;
    if (target === 'mainnet') {
      const confirmed = window.confirm(
        '⚠️ WARNING: Mainnet uses real SOL and real on-chain funds with actual financial risk.\n\nAre you sure you want to switch to Solana Mainnet-Beta?'
      );
      if (!confirmed) return;
    }
    await setNetwork(target);
  };

  const isDevnet = network === 'devnet';
  const displayHeaderBalance = typeof solBalance === 'number' ? `${solBalance.toFixed(3)} SOL` : '--- SOL';

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Network Selector Pill (Devnet vs Mainnet) */}
      <div className="flex items-center bg-slate-950/90 border border-slate-800/90 rounded-xl p-1 shadow-md">
        <button
          id="toggle-network-devnet"
          type="button"
          disabled={switching}
          onClick={() => handleNetworkSwitch('devnet')}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider uppercase transition-all cursor-pointer",
            isDevnet
              ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
              : "text-slate-400 hover:text-white"
          )}
          title="Devnet Cluster (Test Tokens)"
        >
          <Globe className="w-3 h-3" />
          <span>Devnet</span>
        </button>
        <button
          id="toggle-network-mainnet"
          type="button"
          disabled={switching}
          onClick={() => handleNetworkSwitch('mainnet')}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider uppercase transition-all cursor-pointer",
            !isDevnet
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
              : "text-slate-400 hover:text-emerald-400"
          )}
          title="Solana Mainnet-Beta"
        >
          <Flame className="w-3 h-3 fill-current" />
          <span>Mainnet</span>
        </button>
      </div>

      {/* Connected Wallet Status / Button */}
      {activeAddress ? (
        <div className="relative">
          <button
            id="wallet-dropdown-trigger"
            type="button"
            onClick={() => setShowDropdown(!showDropdown)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer text-xs font-mono shadow-md",
              isDevnet 
                ? "bg-slate-900/90 border-cyan-500/40 hover:border-cyan-400/80 text-white" 
                : "bg-slate-900/90 border-emerald-500/40 hover:border-emerald-400/80 text-white"
            )}
          >
            {/* Status Dot */}
            <span className="relative flex h-2 w-2">
              <span className={cn(
                "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                isDevnet ? "bg-cyan-400" : "bg-emerald-400"
              )}></span>
              <span className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                isDevnet ? "bg-cyan-500" : "bg-emerald-500"
              )}></span>
            </span>

            {/* Icon */}
            {isSessionActive ? (
              <Key className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Wallet className="w-3.5 h-3.5 text-cyan-400" />
            )}

            {/* Address */}
            <span className="font-bold">
              {activeAddress.slice(0, 4)}...{activeAddress.slice(-4)}
            </span>

            {/* Header Balance */}
            <div className={cn(
              "flex items-center gap-1 pl-1.5 border-l border-slate-700/60 text-[11px] font-sans font-bold",
              isDevnet ? "text-cyan-300" : "text-emerald-400"
            )}>
              <span>{displayHeaderBalance}</span>
              <span className={cn(
                "text-[9px] font-mono px-1 py-0.2 rounded uppercase",
                isDevnet ? "bg-cyan-500/20 text-cyan-300" : "bg-emerald-500/20 text-emerald-300"
              )}>
                {network}
              </span>
            </div>

            <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
          </button>

          {/* Wallet Dropdown Details */}
          {showDropdown && (
            <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-800 bg-slate-950/98 p-4 shadow-2xl backdrop-blur-xl z-50 text-slate-200 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <ShieldCheck className={cn("w-4 h-4", isDevnet ? "text-cyan-400" : "text-emerald-400")} />
                  <span className="font-bold text-slate-100">
                    {isSessionActive ? 'Session Keypair' : wallet?.adapter.name || 'Browser Wallet'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDropdown(false)}
                  className="text-slate-500 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* On-Chain Balance Card */}
              <div className="my-3 space-y-2">
                <div className={cn(
                  "p-3 rounded-xl border transition-all",
                  isDevnet 
                    ? "bg-cyan-950/20 border-cyan-500/40" 
                    : "bg-emerald-950/20 border-emerald-500/40"
                )}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        {isDevnet ? 'Devnet On-Chain Balance' : 'Mainnet On-Chain Balance'}
                      </span>
                      <span className={cn(
                        "text-[8px] font-black px-1.5 py-0.5 rounded uppercase",
                        isDevnet ? "bg-cyan-500/20 text-cyan-300" : "bg-emerald-500/20 text-emerald-300"
                      )}>
                        {network}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleManualRefresh}
                      disabled={isRefreshing || status === 'loading'}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                      title="Fetch on-chain balance"
                    >
                      <RefreshCw className={cn("w-3 h-3", (isRefreshing || status === 'loading') && "animate-spin text-cyan-400")} />
                    </button>
                  </div>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className={cn(
                      "text-base font-black font-mono",
                      isDevnet ? "text-cyan-300" : "text-emerald-400"
                    )}>
                      {typeof solBalance === 'number' ? `${solBalance.toFixed(4)} SOL` : '0.0000 SOL'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {status === 'live' ? 'Synced RPC' : status === 'loading' ? 'Fetching...' : status === 'stale' ? 'Stale' : 'Idle'}
                    </span>
                  </div>
                  <div className="mt-1.5 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>Reserved Gas Buffer:</span>
                    <span className="text-slate-300">{typeof reservedSol === 'number' ? reservedSol.toFixed(4) : '0.0000'} SOL</span>
                  </div>
                </div>

                {/* Trading Available Summary */}
                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-300">Trading Available Balance</div>
                      <div className="text-[9px] text-slate-500">
                        Total On-Chain SOL - Reserved Buffer
                      </div>
                    </div>
                  </div>
                  <span className={cn(
                    "text-sm font-black font-mono",
                    isDevnet ? "text-cyan-300" : "text-emerald-300"
                  )}>
                    {typeof availableSolBalance === 'number' ? `${availableSolBalance.toFixed(4)} SOL` : '0.0000 SOL'}
                  </span>
                </div>

                {isDevnet && (
                  <div className="p-2 rounded-lg bg-cyan-950/30 border border-cyan-500/20 flex items-center justify-between text-[10px] text-cyan-400">
                    <span className="flex items-center gap-1">
                      <Shield className="w-3 h-3" /> Need free Devnet SOL?
                    </span>
                    <a
                      href="https://faucet.solana.com"
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-bold hover:text-cyan-200"
                    >
                      Devnet Faucet ↗
                    </a>
                  </div>
                )}
              </div>

                            {/* Key Management Row */}
              <div className="mb-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Wallet Key Management</div>
                  <button
                    type="button"
                    onClick={() => setShowKeyForm(!showKeyForm)}
                    className="text-[10px] font-bold text-amber-400 hover:text-amber-300 underline cursor-pointer flex items-center gap-1"
                  >
                    <Key className="w-3 h-3" />
                    {showKeyForm ? 'Cancel' : 'Update Wallet Key'}
                  </button>
                </div>

                {showKeyForm && (
                  <form onSubmit={handleUpdateKeySubmit} className="p-2.5 rounded-xl bg-slate-900 border border-amber-500/30 space-y-2">
                    <div className="text-[10px] text-slate-300 font-medium">
                      Enter Base58 private key or 64-byte JSON array:
                    </div>
                    <textarea
                      rows={2}
                      value={inputKey}
                      onChange={(e) => setInputKey(e.target.value)}
                      placeholder="Paste Base58 private key or [12,34,...]"
                      className="w-full text-[11px] font-mono p-2 rounded-lg bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60"
                    />
                    {keyError && (
                      <div className="text-[10px] font-semibold text-rose-400 bg-rose-950/40 p-1.5 rounded border border-rose-500/20">
                        {keyError}
                      </div>
                    )}
                    {keySuccess && (
                      <div className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 p-1.5 rounded border border-emerald-500/20">
                        {keySuccess}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="submit"
                        className="flex-1 py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] transition-all cursor-pointer"
                      >
                        Save & Apply Key
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleGenerateSessionWallet();
                          setShowKeyForm(false);
                        }}
                        className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-[10px] transition-all cursor-pointer"
                        title="Reset to default session key"
                      >
                        Reset Key
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Address Row */}
              <div className="mb-3 space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Active Wallet Address</div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800/60 font-mono text-[11px] text-slate-300">
                  <span className="truncate pr-2">{activeAddress}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(activeAddress)}
                      className="text-slate-400 hover:text-white p-1 cursor-pointer"
                      title="Copy Address"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <a
                      href={isDevnet ? `https://solscan.io/account/${activeAddress}?cluster=devnet` : `https://solscan.io/account/${activeAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-400 hover:text-cyan-400 p-1 cursor-pointer"
                      title="View on Solscan"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                {publicKey ? (
                  <button
                    type="button"
                    onClick={() => {
                      disconnect();
                      setShowDropdown(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-bold transition-all cursor-pointer text-xs"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Disconnect Wallet
                  </button>
                ) : isSessionActive ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleDisconnectSession();
                      setShowDropdown(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-bold transition-all cursor-pointer text-xs"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Clear Session Keypair
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {/* Custom Wallet Multi Button Container */}
          <div className="wallet-adapter-button-custom border border-cyan-500/40 rounded-xl overflow-hidden shadow-lg shadow-cyan-950/30">
            <WalletMultiButton className="!bg-cyan-600 hover:!bg-cyan-500 !text-white !font-bold !text-xs !h-8 !px-3.5 !rounded-xl transition-all" />
          </div>

          <button
            type="button"
            onClick={handleGenerateSessionWallet}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-bold text-xs transition-all cursor-pointer"
            title="Generate local keypair for auto-trading"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>Session Wallet</span>
          </button>
        </div>
      )}
    </div>
  );
};
