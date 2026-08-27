// src/store/paperWalletStore.ts
import { create } from 'zustand';
import { DEFAULT_PAPER_TRADING_ADDRESS } from '../constants/solana';
import { useBalanceStore } from './balanceStore';

const STORAGE_KEY = 'app_paper_wallet_data';
const DEFAULT_INITIAL_SOL = 10.0;

export interface PaperPosition {
  mint: string;
  quantity: number;
  avgEntryPriceSol: number;
  totalCostSol: number;
  lastUpdatedAt: number;
}

interface PaperWalletData {
  solBalance: number;
  tokenBalances: Record<string, number>;
  positions: Record<string, PaperPosition>;
  address: string;
}

interface PaperWalletState extends PaperWalletData {
  setSolBalance: (sol: number) => void;
  adjustSolBalance: (delta: number) => void;
  setTokenBalance: (mint: string, balance: number) => void;
  adjustTokenBalance: (mint: string, delta: number) => void;
  recordBuyPosition: (mint: string, tokenQuantity: number, totalCostSol: number) => void;
  recordSellPosition: (mint: string, tokenQuantity: number) => void;
  getPosition: (mint: string) => PaperPosition | undefined;
  resetPaperWallet: (initialSol?: number) => void;
  addPaperSol: (amount: number) => void;
  syncToBalanceStore: () => void;
}

function loadInitialData(): PaperWalletData {
  if (typeof window === 'undefined') {
    return {
      solBalance: DEFAULT_INITIAL_SOL,
      tokenBalances: {},
      positions: {},
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
        positions: parsed.positions && typeof parsed.positions === 'object' ? parsed.positions : {},
        address: DEFAULT_PAPER_TRADING_ADDRESS,
      };
    }
  } catch (e) {
    console.warn('[PaperWalletStore] Failed to load persisted state:', e);
  }

  return {
    solBalance: DEFAULT_INITIAL_SOL,
    tokenBalances: {},
    positions: {},
    address: DEFAULT_PAPER_TRADING_ADDRESS,
  };
}

function persistData(data: PaperWalletData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      solBalance: data.solBalance,
      tokenBalances: data.tokenBalances,
      positions: data.positions,
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
      const clamped = Math.max(0, balance);
      const nextTokens = { ...get().tokenBalances, [mint]: clamped };
      const nextPositions = { ...get().positions };
      if (clamped <= 0) {
        delete nextPositions[mint];
      }
      set({ tokenBalances: nextTokens, positions: nextPositions });
      persistData({ ...get(), tokenBalances: nextTokens, positions: nextPositions });
      sync();
    },

    adjustTokenBalance: (mint, delta) => {
      const current = get().tokenBalances[mint] || 0;
      const next = Math.max(0, current + delta);
      const nextTokens = { ...get().tokenBalances, [mint]: next };
      const nextPositions = { ...get().positions };
      if (next <= 0) {
        delete nextPositions[mint];
      }
      set({ tokenBalances: nextTokens, positions: nextPositions });
      persistData({ ...get(), tokenBalances: nextTokens, positions: nextPositions });
      sync();
    },

    recordBuyPosition: (mint, tokenQuantity, totalCostSol) => {
      if (tokenQuantity <= 0) return;
      const existing = get().positions[mint];
      let updatedPos: PaperPosition;

      if (existing && existing.quantity > 0) {
        const newQty = existing.quantity + tokenQuantity;
        const newCost = existing.totalCostSol + totalCostSol;
        updatedPos = {
          mint,
          quantity: newQty,
          totalCostSol: newCost,
          avgEntryPriceSol: newQty > 0 ? newCost / newQty : 0,
          lastUpdatedAt: Date.now(),
        };
      } else {
        updatedPos = {
          mint,
          quantity: tokenQuantity,
          totalCostSol,
          avgEntryPriceSol: tokenQuantity > 0 ? totalCostSol / tokenQuantity : 0,
          lastUpdatedAt: Date.now(),
        };
      }

      const nextTokens = { ...get().tokenBalances, [mint]: updatedPos.quantity };
      const nextPositions = { ...get().positions, [mint]: updatedPos };
      set({ tokenBalances: nextTokens, positions: nextPositions });
      persistData({ ...get(), tokenBalances: nextTokens, positions: nextPositions });
      sync();
    },

    recordSellPosition: (mint, tokenQuantitySold) => {
      if (tokenQuantitySold <= 0) return;
      const existing = get().positions[mint];
      const currentBal = get().tokenBalances[mint] || 0;
      const nextBal = Math.max(0, currentBal - tokenQuantitySold);

      const nextTokens = { ...get().tokenBalances, [mint]: nextBal };
      const nextPositions = { ...get().positions };

      if (nextBal <= 0.00000001 || !existing) {
        delete nextPositions[mint];
      } else {
        const remainingFraction = nextBal / existing.quantity;
        nextPositions[mint] = {
          ...existing,
          quantity: nextBal,
          totalCostSol: existing.totalCostSol * remainingFraction,
          lastUpdatedAt: Date.now(),
        };
      }

      set({ tokenBalances: nextTokens, positions: nextPositions });
      persistData({ ...get(), tokenBalances: nextTokens, positions: nextPositions });
      sync();
    },

    getPosition: (mint) => {
      return get().positions[mint];
    },

    resetPaperWallet: (initialSol = DEFAULT_INITIAL_SOL) => {
      const resetState: PaperWalletData = {
        solBalance: initialSol,
        tokenBalances: {},
        positions: {},
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
