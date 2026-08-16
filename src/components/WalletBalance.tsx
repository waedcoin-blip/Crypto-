// src/components/WalletBalance.tsx
import React, { useEffect, useRef } from 'react';
import { WalletBalanceService } from '../services/WalletBalanceService';
import { useBalanceStore } from '../store/balanceStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { Activity, RefreshCw, AlertCircle, CheckCircle2, Shield } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  walletAddress: string | null;
  className?: string;
}

export function WalletBalance({
  walletAddress,
  className
}: Props) {
  const network = useTradingEnvironmentStore((s) => s.network);
  const solBalance = useBalanceStore((s) => s.solBalance);
  const available = useBalanceStore((s) => s.availableSolBalance);
  const status = useBalanceStore((s) => s.status);
  const error = useBalanceStore((s) => s.error);

  const serviceRef = useRef<WalletBalanceService | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      serviceRef.current?.destroy();
      serviceRef.current = null;
      useBalanceStore.getState().reset();
      return;
    }

    const service = new WalletBalanceService(network);
    serviceRef.current = service;
    service.start(walletAddress, 5_000);

    return () => {
      service.destroy();
      if (serviceRef.current === service) {
        serviceRef.current = null;
      }
    };
  }, [network, walletAddress]);

  const handleManualRefresh = () => {
    if (serviceRef.current && walletAddress) {
      void serviceRef.current.refresh(walletAddress);
    }
  };

  const isDevnet = network === 'devnet';

  return (
    <div
      id="wallet-balance-card"
      className={cn(
        "p-3 rounded-2xl border backdrop-blur-md shadow-lg transition-all",
        isDevnet
          ? "bg-cyan-950/20 border-cyan-500/30"
          : "bg-emerald-950/20 border-emerald-500/30",
        className
      )}
    >
      <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider",
              isDevnet
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
            )}
          >
            {network.toUpperCase()}
          </span>
          <span className="text-[11px] font-medium text-slate-400">
            {isDevnet ? 'Devnet Cluster (Test Tokens)' : 'Mainnet Beta'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 text-[10px] font-mono">
            {status === 'live' && (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="w-3 h-3" /> Live
              </span>
            )}
            {status === 'loading' && (
              <span className="flex items-center gap-1 text-amber-400">
                <RefreshCw className="w-3 h-3 animate-spin" /> Syncing
              </span>
            )}
            {status === 'stale' && (
              <span className="flex items-center gap-1 text-amber-400">
                <Activity className="w-3 h-3" /> Stale
              </span>
            )}
            {status === 'error' && (
              <span className="flex items-center gap-1 text-rose-400" title={error || ''}>
                <AlertCircle className="w-3 h-3" /> Error
              </span>
            )}
            {status === 'idle' && (
              <span className="text-slate-500">Idle</span>
            )}
          </div>

          <button
            onClick={handleManualRefresh}
            type="button"
            className="p-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
            title="Refresh On-Chain SOL Balance"
          >
            <RefreshCw className={cn("w-3 h-3", status === 'loading' && "animate-spin text-cyan-400")} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-2.5">
        <div>
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
            On-Chain Wallet
          </div>
          <div className="text-sm font-black font-mono mt-0.5 text-slate-100">
            {typeof solBalance === 'number'
              ? `${solBalance.toFixed(4)} SOL`
              : 'Loading...'}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
            Trading Available
          </div>
          <div
            className={cn(
              "text-sm font-black font-mono mt-0.5",
              isDevnet ? "text-cyan-400" : "text-emerald-400"
            )}
          >
            {typeof available === 'number'
              ? `${available.toFixed(4)} SOL`
              : 'Loading...'}
          </div>
        </div>
      </div>

      {isDevnet && (
        <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-cyan-400/80 font-mono">
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3 text-cyan-400" /> Free Faucet SOL (Devnet)
          </span>
          <a
            href="https://faucet.solana.com"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-cyan-300"
          >
            Get Devnet SOL ↗
          </a>
        </div>
      )}
    </div>
  );
}
