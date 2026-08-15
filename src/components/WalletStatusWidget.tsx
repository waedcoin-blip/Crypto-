// src/components/WalletStatusWidget.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { 
  Wallet, 
  Key, 
  Copy, 
  Check, 
  RefreshCw, 
  LogOut, 
  Zap, 
  ShieldCheck, 
  AlertTriangle,
  ChevronDown,
  ExternalLink
} from 'lucide-react';
import { useTradeMode } from '../context/TradeModeContext';
import { useAppStore } from '../store/appStore';
import { cn } from '../lib/utils';

export const WalletStatusWidget: React.FC<{ className?: string }> = ({ className }) => {
  const { publicKey, wallet, connected, connecting, disconnect } = useWallet();
  const { connection } = useConnection();
  const { mode, setMode } = useTradeMode();
  const { sessionWallet, setSessionWallet, isLiveTrading, setIsLiveTrading } = useAppStore();

  const [realSolBalance, setRealSolBalance] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Active address: prioritize connected browser wallet, fallback to session wallet keypair
  const activeAddress = publicKey ? publicKey.toBase58() : sessionWallet ? sessionWallet.publicKey.toBase58() : null;
  const isSessionActive = !publicKey && !!sessionWallet;

  const fetchBalance = useCallback(async () => {
    if (!activeAddress || !connection) {
      setRealSolBalance(null);
      return;
    }
    setIsRefreshing(true);
    try {
      const lamports = await connection.getBalance(new PublicKey(activeAddress), 'confirmed');
      setRealSolBalance(lamports / LAMPORTS_PER_SOL);
    } catch (e) {
      console.warn('Failed to fetch live SOL balance:', e);
      setRealSolBalance(null);
    } finally {
      setIsRefreshing(false);
    }
  }, [activeAddress, connection]);

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 8000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateSessionWallet = () => {
    const kp = Keypair.generate();
    const encoded = bs58.encode(kp.secretKey);
    sessionStorage.setItem('matrix_session_key', encoded);
    setSessionWallet(kp);
    fetchBalance();
  };

  const handleDisconnectSession = () => {
    sessionStorage.removeItem('matrix_session_key');
    setSessionWallet(null);
    setRealSolBalance(null);
  };

  const handleModeToggle = (newMode: 'paper' | 'real') => {
    setMode(newMode);
    setIsLiveTrading(newMode === 'real');
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Trade Mode Pill (Paper vs Live) */}
      <div className="flex items-center bg-slate-950/90 border border-slate-800/90 rounded-xl p-1 shadow-md">
        <button
          onClick={() => handleModeToggle('paper')}
          className={cn(
            "px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider uppercase transition-all cursor-pointer",
            mode === 'paper' && !isLiveTrading
              ? "bg-slate-200 text-slate-950 shadow-sm"
              : "text-slate-400 hover:text-white"
          )}
        >
          Paper
        </button>
        <button
          onClick={() => handleModeToggle('real')}
          className={cn(
            "px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider uppercase transition-all cursor-pointer flex items-center gap-1",
            mode === 'real' || isLiveTrading
              ? "bg-rose-600 text-white shadow-sm shadow-rose-900/50"
              : "text-slate-400 hover:text-rose-400"
          )}
        >
          <Zap className="w-2.5 h-2.5 fill-current" />
          Live
        </button>
      </div>

      {/* Connected Wallet Status / Button */}
      {activeAddress ? (
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer text-xs font-mono shadow-md",
              isLiveTrading 
                ? "bg-slate-900/90 border-emerald-500/40 hover:border-emerald-400/80 text-white" 
                : "bg-slate-900/80 border-indigo-500/30 hover:border-indigo-400/60 text-slate-200"
            )}
          >
            {/* Status Dot */}
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>

            {/* Icon */}
            {isSessionActive ? (
              <Key className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Wallet className="w-3.5 h-3.5 text-indigo-400" />
            )}

            {/* Address */}
            <span className="font-bold">
              {activeAddress.slice(0, 4)}...{activeAddress.slice(-4)}
            </span>

            {/* SOL Balance */}
            <div className="flex items-center gap-1 pl-1.5 border-l border-slate-700/60 text-[11px] font-sans font-bold text-emerald-400">
              <span>{realSolBalance !== null ? `${realSolBalance.toFixed(3)} SOL` : '0.00 SOL'}</span>
            </div>

            <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
          </button>

          {/* Wallet Dropdown Details */}
          {showDropdown && (
            <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-800 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-xl z-50 text-slate-200 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-slate-100">
                    {isSessionActive ? 'Session Keypair' : wallet?.adapter.name || 'Browser Wallet'}
                  </span>
                </div>
                <button
                  onClick={() => setShowDropdown(false)}
                  className="text-slate-500 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {/* Balance Card */}
              <div className="my-3 p-3 rounded-xl bg-slate-900/90 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Live Wallet Balance</div>
                  <div className="text-base font-black text-emerald-400 font-mono mt-0.5">
                    {realSolBalance !== null ? `${realSolBalance.toFixed(4)} SOL` : '--- SOL'}
                  </div>
                </div>
                <button
                  onClick={fetchBalance}
                  disabled={isRefreshing}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                  title="Refresh Balance"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin text-indigo-400")} />
                </button>
              </div>

              {/* Address Row */}
              <div className="mb-3 space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Address</div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800/60 font-mono text-[11px] text-slate-300">
                  <span className="truncate pr-2">{activeAddress}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => copyToClipboard(activeAddress)}
                      className="text-slate-400 hover:text-white p-1"
                      title="Copy Address"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <a
                      href={`https://solscan.io/account/${activeAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-400 hover:text-indigo-400 p-1"
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
          <div className="wallet-adapter-button-custom border border-indigo-500/40 rounded-xl overflow-hidden shadow-lg shadow-indigo-950/30">
            <WalletMultiButton className="!bg-indigo-600 hover:!bg-indigo-500 !text-white !font-bold !text-xs !h-8 !px-3.5 !rounded-xl transition-all" />
          </div>

          <button
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
