// src/components/NetworkSelector.tsx
import React from 'react';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { ShieldCheck, Flame, Globe } from 'lucide-react';
import { cn } from '../lib/utils';

interface NetworkSelectorProps {
  className?: string;
  compact?: boolean;
}

export const NetworkSelector: React.FC<NetworkSelectorProps> = ({ className, compact = false }) => {
  const {
    network,
    switching,
    setNetwork,
  } = useTradingEnvironmentStore();

  async function changeNetwork(next: 'devnet' | 'mainnet') {
    if (next === network) return;

    if (next === 'mainnet') {
      const confirmed = window.confirm(
        '⚠️ WARNING: Mainnet uses real SOL and real on-chain funds with actual financial risk.\n\nAre you sure you want to switch to Solana Mainnet-Beta?'
      );

      if (!confirmed) {
        return;
      }
    }

    try {
      await setNetwork(next);
    } catch (e: any) {
      alert(`Network switch failed: ${e.message || e}`);
    }
  }

  return (
    <div className={cn("inline-flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800 shadow-inner", className)}>
      <button
        id="devnet-network-btn"
        type="button"
        disabled={switching}
        onClick={() => changeNetwork('devnet')}
        className={cn(
          "flex items-center gap-1.5 font-bold transition-all rounded-lg cursor-pointer",
          compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
          network === 'devnet'
            ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-sm"
            : "text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent"
        )}
        title="Solana Devnet (Safe testing environment with faucet support)"
      >
        <Globe className="w-3.5 h-3.5" />
        <span>{network === 'devnet' ? '✓ ' : ''}DEVNET</span>
      </button>

      <button
        id="mainnet-network-btn"
        type="button"
        disabled={switching}
        onClick={() => changeNetwork('mainnet')}
        className={cn(
          "flex items-center gap-1.5 font-bold transition-all rounded-lg cursor-pointer",
          compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
          network === 'mainnet'
            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm"
            : "text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent"
        )}
        title="Solana Mainnet-Beta (Real on-chain transactions & real SOL)"
      >
        <Flame className="w-3.5 h-3.5" />
        <span>{network === 'mainnet' ? '✓ ' : ''}MAINNET</span>
      </button>
    </div>
  );
};
