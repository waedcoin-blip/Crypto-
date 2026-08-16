// src/components/TradeModeToggle.tsx
import React from 'react';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { Globe, Flame } from 'lucide-react';
import { cn } from '../lib/utils';

export const TradeModeToggle: React.FC = () => {
  const { network, setNetwork, switching } = useTradingEnvironmentStore();

  const handleSwitch = async (target: 'devnet' | 'mainnet') => {
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

  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/90 p-1.5 shadow-md">
      <button
        type="button"
        disabled={switching}
        onClick={() => handleSwitch('devnet')}
        className={cn(
          "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer",
          isDevnet
            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
            : "text-slate-400 hover:text-white"
        )}
        title="Solana Devnet Cluster (Safe Test Funds)"
      >
        <Globe className="w-3.5 h-3.5" />
        <span>{isDevnet ? '✓ ' : ''}DEVNET</span>
      </button>

      <button
        type="button"
        disabled={switching}
        onClick={() => handleSwitch('mainnet')}
        className={cn(
          "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer",
          !isDevnet
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
            : "text-slate-400 hover:text-emerald-400"
        )}
        title="Solana Mainnet-Beta (Real SOL)"
      >
        <Flame className="w-3.5 h-3.5" />
        <span>{!isDevnet ? '✓ ' : ''}MAINNET</span>
      </button>

      {!isDevnet && (
        <span className="text-[10px] text-emerald-400 font-bold tracking-wider animate-pulse px-1.5">
          MAINNET ACTIVE
        </span>
      )}
      {isDevnet && (
        <span className="text-[10px] text-cyan-400 font-mono tracking-wider px-1.5">
          TEST CLUSTER
        </span>
      )}
    </div>
  );
};
