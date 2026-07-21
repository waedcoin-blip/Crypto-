import { create } from 'zustand';

export interface BuySignal {
  id: string;
  tokenAddress: string;
  symbol: string;
  name: string;

  // Prices for SimRealPage to verify before buying
  entryPriceUsd: number;      // PnLPage's simulation entry
  triggerPriceUsd: number;    // Price when +1% was hit
  profitPercent: number;      // Actual profit at trigger time

  // Token metadata for SimRealPage's fresh quote
  liquidityUsd: number;
  volume24h: number;
  dexId: string;
  pairAddress: string;

  // Simulation context
  simAmountSol: number;
  simEntryTime: number;

  // Lifecycle
  timestamp: number;
  status: 'pending' | 'picked_up' | 'executing' | 'executed' | 'rejected' | 'failed';
  rejectionReason?: string;
  txSignature?: string;
  errorMessage?: string;
}

interface BuySignalStore {
  signals: BuySignal[];
  stats: {
    totalEmitted: number;
    totalExecuted: number;
    totalRejected: number;
    totalFailed: number;
  };

  emitSignal: (signal: Omit<BuySignal, 'id' | 'timestamp' | 'status'>) => void;
  
  // Support both interfaces for ultimate compatibility
  claimNextPending: () => BuySignal | null;
  claimNextSignal: () => BuySignal | null;
  
  markExecuting: (signalId: string) => void;
  markExecuted: (signalId: string, txSignature: string) => void;
  markFailed: (signalId: string, reason: string) => void;
  markRejected: (signalId: string, reason: string) => void;
  
  pruneOld: (maxAgeMs?: number) => void;
  pruneOldSignals: (maxAgeMs?: number) => void;
  
  getPendingCount: () => number;
}

let counter = 0;

export const useBuySignalStore = create<BuySignalStore>((set, get) => ({
  signals: [],
  stats: { totalEmitted: 0, totalExecuted: 0, totalRejected: 0, totalFailed: 0 },

  emitSignal: (signal) => {
    const newSignal: BuySignal = {
      ...signal,
      id: `sig-${Date.now()}-${++counter}`,
      timestamp: Date.now(),
      status: 'pending',
    };

    set(state => ({
      signals: [...state.signals, newSignal],
      stats: { ...state.stats, totalEmitted: state.stats.totalEmitted + 1 },
    }));

    console.log(
      `[Signal] Emitted: ${signal.symbol} ` +
      `entry=$${signal.entryPriceUsd.toFixed(8)} ` +
      `trigger=$${signal.triggerPriceUsd.toFixed(8)} ` +
      `profit=+${signal.profitPercent.toFixed(2)}%`
    );
  },

  claimNextPending: () => {
    const state = get();
    const idx = state.signals.findIndex(s => s.status === 'pending');
    if (idx === -1) return null;

    const updated = [...state.signals];
    updated[idx] = { ...updated[idx], status: 'picked_up' };
    set({ signals: updated });

    return state.signals[idx];
  },

  claimNextSignal: () => {
    return get().claimNextPending();
  },

  markExecuting: (signalId) => {
    set(state => ({
      signals: state.signals.map(s =>
        s.id === signalId ? { ...s, status: 'executing' as const } : s
      ),
    }));
  },

  markExecuted: (signalId, txSignature) => {
    set(state => ({
      signals: state.signals.map(s =>
        s.id === signalId
          ? { ...s, status: 'executed' as const, txSignature }
          : s
      ),
      stats: { ...state.stats, totalExecuted: state.stats.totalExecuted + 1 },
    }));
  },

  markFailed: (signalId, reason) => {
    set(state => ({
      signals: state.signals.map(s =>
        s.id === signalId
          ? { ...s, status: 'failed' as const, errorMessage: reason, rejectionReason: reason }
          : s
      ),
      stats: { ...state.stats, totalFailed: state.stats.totalFailed + 1 },
    }));
  },

  markRejected: (signalId, reason) => {
    set(state => ({
      signals: state.signals.map(s =>
        s.id === signalId
          ? { ...s, status: 'rejected' as const, rejectionReason: reason }
          : s
      ),
      stats: { ...state.stats, totalRejected: state.stats.totalRejected + 1 },
    }));
  },

  pruneOld: (maxAgeMs = 10 * 60 * 1000) => {
    const cutoff = Date.now() - maxAgeMs;
    set(state => ({
      signals: state.signals.filter(
        s => s.timestamp > cutoff || s.status === 'executing'
      ),
    }));
  },

  pruneOldSignals: (maxAgeMs = 10 * 60 * 1000) => {
    get().pruneOld(maxAgeMs);
  },

  getPendingCount: () => {
    return get().signals.filter(s => s.status === 'pending').length;
  },
}));
