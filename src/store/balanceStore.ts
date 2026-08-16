// src/store/balanceStore.ts
import { create } from 'zustand';

export interface WalletBalanceState {
  realSolBalance: number | null;
  paperSolBalance: number;
  availableSolBalance: number;
  reservedSol: number;
  safetyBufferSol: number;
  walletAddress: string | null;
  lastUpdated: number | null;
  tradeMode: 'real' | 'paper';
  status: 'loading' | 'live' | 'stale' | 'error' | 'idle';
  error: string | null;

  // Actions
  setRealSolBalance: (balance: number | null, address?: string | null) => void;
  setPaperSolBalance: (balanceOrUpdater: number | ((prev: number) => number)) => void;
  setTradeMode: (mode: 'real' | 'paper') => void;
  setReservedSol: (amount: number) => void;
  setSafetyBufferSol: (amount: number) => void;
  setWalletAddress: (address: string | null) => void;
  setStatus: (status: WalletBalanceState['status'], error?: string | null) => void;
  deductTrade: (amountSol: number, isReal?: boolean) => boolean;
  creditTrade: (amountSol: number, isReal?: boolean) => void;
  resetPaperBalance: (amount?: number) => void;
}

const PAPER_BALANCE_KEY = 'app_authoritative_paper_balance_v1';
const RESERVED_SOL_KEY = 'app_reserved_sol';
const SAFETY_BUFFER_KEY = 'app_safety_buffer_sol';

function loadInitialPaperBalance(): number {
  try {
    const saved = localStorage.getItem(PAPER_BALANCE_KEY);
    if (saved && !isNaN(Number(saved)) && Number(saved) >= 0) {
      return Number(saved);
    }
    // Migration fallback from legacy keys
    const legacyV4 = localStorage.getItem('app_simulationBalance_v4');
    if (legacyV4 && !isNaN(Number(legacyV4)) && Number(legacyV4) > 0) {
      return Number(legacyV4);
    }
    const legacyAuto = localStorage.getItem('juipter_auto_simWalletBalance');
    if (legacyAuto && !isNaN(Number(legacyAuto)) && Number(legacyAuto) > 0) {
      return Number(legacyAuto);
    }
  } catch (e) {
    console.warn('[BalanceStore] Failed to load initial paper balance:', e);
  }
  return 10.0;
}

function calculateAvailable(
  mode: 'real' | 'paper',
  real: number | null,
  paper: number,
  reserved: number,
  buffer: number
): number {
  if (mode === 'paper') {
    return Math.max(0, paper);
  }
  if (real === null) return 0;
  return Math.max(0, real - reserved - buffer);
}

export const useBalanceStore = create<WalletBalanceState>((set, get) => {
  const initialMode = (localStorage.getItem('trade_mode') === 'real' || localStorage.getItem('is_live_trading') === 'true') ? 'real' : 'paper';
  const initialPaper = loadInitialPaperBalance();
  const initialReserved = Number(localStorage.getItem(RESERVED_SOL_KEY)) || 0.02;
  const initialBuffer = Number(localStorage.getItem(SAFETY_BUFFER_KEY)) || 0.005;

  return {
    realSolBalance: null,
    paperSolBalance: initialPaper,
    availableSolBalance: calculateAvailable(initialMode, null, initialPaper, initialReserved, initialBuffer),
    reservedSol: initialReserved,
    safetyBufferSol: initialBuffer,
    walletAddress: null,
    lastUpdated: null,
    tradeMode: initialMode,
    status: 'idle',
    error: null,

    setRealSolBalance: (balance, address) => {
      set((state) => {
        const addr = address !== undefined ? address : state.walletAddress;
        const available = calculateAvailable(
          state.tradeMode,
          balance,
          state.paperSolBalance,
          state.reservedSol,
          state.safetyBufferSol
        );
        return {
          realSolBalance: balance,
          walletAddress: addr,
          availableSolBalance: available,
          lastUpdated: Date.now(),
          status: balance !== null ? 'live' : 'error',
          error: null
        };
      });
    },

    setPaperSolBalance: (balanceOrUpdater) => {
      set((state) => {
        const nextVal = typeof balanceOrUpdater === 'function'
          ? balanceOrUpdater(state.paperSolBalance)
          : balanceOrUpdater;
        const clamped = Math.max(0, isNaN(nextVal) ? 0 : nextVal);
        try {
          localStorage.setItem(PAPER_BALANCE_KEY, clamped.toString());
          localStorage.setItem('app_simulationBalance_v4', clamped.toString());
          localStorage.setItem('juipter_auto_simWalletBalance', clamped.toString());
        } catch (e) {
          // ignore quota
        }
        const available = calculateAvailable(
          state.tradeMode,
          state.realSolBalance,
          clamped,
          state.reservedSol,
          state.safetyBufferSol
        );
        return {
          paperSolBalance: clamped,
          availableSolBalance: available,
          lastUpdated: Date.now()
        };
      });
    },

    setTradeMode: (mode) => {
      set((state) => {
        const available = calculateAvailable(
          mode,
          state.realSolBalance,
          state.paperSolBalance,
          state.reservedSol,
          state.safetyBufferSol
        );
        return {
          tradeMode: mode,
          availableSolBalance: available
        };
      });
    },

    setReservedSol: (amount) => {
      const clamped = Math.max(0, amount);
      try {
        localStorage.setItem(RESERVED_SOL_KEY, clamped.toString());
      } catch (e) {}
      set((state) => ({
        reservedSol: clamped,
        availableSolBalance: calculateAvailable(
          state.tradeMode,
          state.realSolBalance,
          state.paperSolBalance,
          clamped,
          state.safetyBufferSol
        )
      }));
    },

    setSafetyBufferSol: (amount) => {
      const clamped = Math.max(0, amount);
      try {
        localStorage.setItem(SAFETY_BUFFER_KEY, clamped.toString());
      } catch (e) {}
      set((state) => ({
        safetyBufferSol: clamped,
        availableSolBalance: calculateAvailable(
          state.tradeMode,
          state.realSolBalance,
          state.paperSolBalance,
          state.reservedSol,
          clamped
        )
      }));
    },

    setWalletAddress: (address) => {
      set({ walletAddress: address });
    },

    setStatus: (status, error = null) => {
      set({ status, error });
    },

    deductTrade: (amountSol, isReal) => {
      const state = get();
      const isLive = isReal ?? (state.tradeMode === 'real');
      
      if (isLive) {
        // In real mode, real balance will be refreshed from blockchain,
        // but we optimistically update available balance to prevent overdraft race conditions
        const currentAvailable = state.availableSolBalance;
        if (currentAvailable < amountSol) {
          return false;
        }
        set((prev) => ({
          availableSolBalance: Math.max(0, prev.availableSolBalance - amountSol)
        }));
        return true;
      } else {
        // In paper mode, deduct from paperSolBalance
        if (state.paperSolBalance < amountSol) {
          return false;
        }
        const next = Math.max(0, state.paperSolBalance - amountSol);
        try {
          localStorage.setItem(PAPER_BALANCE_KEY, next.toString());
          localStorage.setItem('app_simulationBalance_v4', next.toString());
          localStorage.setItem('juipter_auto_simWalletBalance', next.toString());
        } catch (e) {}
        set((prev) => ({
          paperSolBalance: next,
          availableSolBalance: calculateAvailable(
            prev.tradeMode,
            prev.realSolBalance,
            next,
            prev.reservedSol,
            prev.safetyBufferSol
          ),
          lastUpdated: Date.now()
        }));
        return true;
      }
    },

    creditTrade: (amountSol, isReal) => {
      const state = get();
      const isLive = isReal ?? (state.tradeMode === 'real');
      if (!isLive) {
        const next = state.paperSolBalance + Math.max(0, amountSol);
        try {
          localStorage.setItem(PAPER_BALANCE_KEY, next.toString());
          localStorage.setItem('app_simulationBalance_v4', next.toString());
          localStorage.setItem('juipter_auto_simWalletBalance', next.toString());
        } catch (e) {}
        set((prev) => ({
          paperSolBalance: next,
          availableSolBalance: calculateAvailable(
            prev.tradeMode,
            prev.realSolBalance,
            next,
            prev.reservedSol,
            prev.safetyBufferSol
          ),
          lastUpdated: Date.now()
        }));
      }
    },

    resetPaperBalance: (amount = 10.0) => {
      const target = Math.max(0, amount);
      try {
        localStorage.setItem(PAPER_BALANCE_KEY, target.toString());
        localStorage.setItem('app_simulationBalance_v4', target.toString());
        localStorage.setItem('juipter_auto_simWalletBalance', target.toString());
      } catch (e) {}
      set((prev) => ({
        paperSolBalance: target,
        availableSolBalance: calculateAvailable(
          prev.tradeMode,
          prev.realSolBalance,
          target,
          prev.reservedSol,
          prev.safetyBufferSol
        ),
        lastUpdated: Date.now()
      }));
    }
  };
});
