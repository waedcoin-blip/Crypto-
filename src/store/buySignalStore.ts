import { create } from 'zustand';

export interface BuySignal {
  id: string;
  tokenAddress: string;
  symbol: string;
  buyPrice: number;
  currentPrice: number;
  profitPercent: number;
  sourcePositionAmount: number;
  timestamp: number;
  status: 'pending' | 'picked_up' | 'executed' | 'rejected' | 'failed';
  rejectionReason?: string;
  txSignature?: string;
}

interface BuySignalStore {
  // Queue of signals from PnLPage
  signals: BuySignal[];
  
  // PnLPage calls this when a sim position hits +1%
  emitSignal: (signal: Omit<BuySignal, 'id' | 'timestamp' | 'status'>) => void;
  
  // SimRealPage calls this to claim the next pending signal
  claimNextSignal: () => BuySignal | null;
  
  // SimRealPage calls these to update signal lifecycle
  markExecuted: (signalId: string, txSignature: string) => void;
  markFailed: (signalId: string, reason: string) => void;
  markRejected: (signalId: string, reason: string) => void;
  
  // Cleanup old signals (called on interval)
  pruneOldSignals: (maxAgeMs?: number) => void;
  
  // Stats for UI
  stats: {
    totalEmitted: number;
    totalExecuted: number;
    totalFailed: number;
    totalRejected: number;
  };
}

let signalCounter = 0;

export const useBuySignalStore = create<BuySignalStore>((set, get) => ({
  signals: [],
  
  stats: {
    totalEmitted: 0,
    totalExecuted: 0,
    totalFailed: 0,
    totalRejected: 0,
  },

  emitSignal: (signal) => {
    const newSignal: BuySignal = {
      ...signal,
      id: `sig-${Date.now()}-${++signalCounter}`,
      timestamp: Date.now(),
      status: 'pending',
    };

    set((state) => ({
      signals: [...state.signals, newSignal],
      stats: {
        ...state.stats,
        totalEmitted: state.stats.totalEmitted + 1,
      },
    }));

    console.log(
      `[Signal] Emitted: ${signal.symbol} at +${signal.profitPercent.toFixed(2)}%`
    );
  },

  claimNextSignal: () => {
    const state = get();
    const nextIndex = state.signals.findIndex(s => s.status === 'pending');
    
    if (nextIndex === -1) return null;

    const signal = state.signals[nextIndex];
    const updated = [...state.signals];
    updated[nextIndex] = { ...signal, status: 'picked_up' };

    set({ signals: updated });
    
    console.log(`[Signal] Claimed: ${signal.symbol} (${signal.id})`);
    return signal;
  },

  markExecuted: (signalId, txSignature) => {
    set((state) => ({
      signals: state.signals.map(s =>
        s.id === signalId
          ? { ...s, status: 'executed' as const, txSignature }
          : s
      ),
      stats: {
        ...state.stats,
        totalExecuted: state.stats.totalExecuted + 1,
      },
    }));
    
    console.log(`[Signal] Executed: ${signalId} → ${txSignature}`);
  },

  markFailed: (signalId, reason) => {
    set((state) => ({
      signals: state.signals.map(s =>
        s.id === signalId
          ? { ...s, status: 'failed' as const, rejectionReason: reason }
          : s
      ),
      stats: {
        ...state.stats,
        totalFailed: state.stats.totalFailed + 1,
      },
    }));
    
    console.warn(`[Signal] Failed: ${signalId} — ${reason}`);
  },

  markRejected: (signalId, reason) => {
    set((state) => ({
      signals: state.signals.map(s =>
        s.id === signalId
          ? { ...s, status: 'rejected' as const, rejectionReason: reason }
          : s
      ),
      stats: {
        ...state.stats,
        totalRejected: state.stats.totalRejected + 1,
      },
    }));
    
    console.log(`[Signal] Rejected: ${signalId} — ${reason}`);
  },

  pruneOldSignals: (maxAgeMs = 5 * 60 * 1000) => {
    const cutoff = Date.now() - maxAgeMs;
    set((state) => ({
      signals: state.signals.filter(s => s.timestamp > cutoff),
    }));
  },
}));
