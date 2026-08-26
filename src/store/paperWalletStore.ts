// src/store/paperWalletStore.ts
import { create } from 'zustand';
import { DEFAULT_PAPER_TRADING_ADDRESS } from '../constants/solana';
import { useBalanceStore } from './balanceStore';

const STORAGE_KEY = 'app_paper_wallet_data';
const DEFAULT_INITIAL_SOL = 10.0;

interface PaperWalletData {
  solBalance: number;
  tokenBalances: Record<string, number>;
  address: string;
}

interface PaperWalletState extends PaperWalletData {
  setSolBalance: (sol: number) => void;
  adjustSolBalance: (delta: number) => void;
  setTokenBalance: (mint: string, balance: number) => void;
  adjustTokenBalance: (mint: string, delta: number) => void;
  resetPaperWallet: (initialSol?: number) => void;
  addPaperSol: (amount: number) => void;
  syncToBalanceStore: () => void;
}

function loadInitialData(): PaperWalletData {
  if (typeof window === 'undefined') {
    return {
      solBalance: DEFAULT_INITIAL_SOL,
      tokenBalances: {},
      address: DEFAULT_PAPER_TRADING_ADDRESS,
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        solBalance: typeof parsed.solBalance === 'number' ? parsed.solBalance : DEFAULT_INITIAL_SOL,
        tokenBalances: parsed.tokenBalances && typeof parsed.tokenBalances === 'object' ? parsed.tokenBalances : {},
        address: DEFAULT_PAPER_TRADING_ADDRESS,
      };
    }
  } catch (e) {
    console.warn('[PaperWalletStore] Failed to load persisted state:', e);
  }

  return {
    solBalance: DEFAULT_INITIAL_SOL,
    tokenBalances: {},
    address: DEFAULT_PAPER_TRADING_ADDRESS,
  };
}

function persistData(data: PaperWalletData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      solBalance: data.solBalance,
      tokenBalances: data.tokenBalances,
    }));
  } catch (e) {
    console.warn('[PaperWalletStore] Failed to persist state:', e);
  }
}

export const usePaperWalletStore = create<PaperWalletState>((set, get) => {
  const initial = loadInitialData();

  const sync = () => {
    const { solBalance, tokenBalances, address } = get();
    const bs = useBalanceStore.getState();
    if (bs.network === 'paper') {
      bs.setWalletAddress(address);
      bs.setOnChainBalance({
        solBalance,
        availableSolBalance: solBalance,
        reservedSol: 0,
      });
      bs.setTokenBalances(tokenBalances);
      bs.setStatus('live');
    }
  };

  return {
    ...initial,

    syncToBalanceStore: sync,

    setSolBalance: (sol) => {
      const clamped = Math.max(0, sol);
      set({ solBalance: clamped });
      persistData({ ...get(), solBalance: clamped });
      sync();
    },

    adjustSolBalance: (delta) => {
      const current = get().solBalance;
      const next = Math.max(0, current + delta);
      set({ solBalance: next });
      persistData({ ...get(), solBalance: next });
      sync();
    },

    setTokenBalance: (mint, balance) => {
      const nextTokens = { ...get().tokenBalances, [mint]: Math.max(0, balance) };
      set({ tokenBalances: nextTokens });
      persistData({ ...get(), tokenBalances: nextTokens });
      sync();
    },

    adjustTokenBalance: (mint, delta) => {
      const current = get().tokenBalances[mint] || 0;
      const next = Math.max(0, current + delta);
      const nextTokens = { ...get().tokenBalances, [mint]: next };
      set({ tokenBalances: nextTokens });
      persistData({ ...get(), tokenBalances: nextTokens });
      sync();
    },

    resetPaperWallet: (initialSol = DEFAULT_INITIAL_SOL) => {
      const resetState: PaperWalletData = {
        solBalance: initialSol,
        tokenBalances: {},
        address: DEFAULT_PAPER_TRADING_ADDRESS,
      };
      set(resetState);
      persistData(resetState);
      sync();
    },

    addPaperSol: (amount) => {
      const next = get().solBalance + Math.max(0, amount);
      set({ solBalance: next });
      persistData({ ...get(), solBalance: next });
      sync();
    },
  };
});
