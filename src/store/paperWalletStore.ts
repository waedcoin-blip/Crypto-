// src/store/paperWalletStore.ts
import { create } from 'zustand';
import { DEFAULT_PAPER_TRADING_ADDRESS } from '../constants/solana';
import { useBalanceStore } from './balanceStore';

const STORAGE_KEY = 'app_paper_wallet_data';
const DEFAULT_INITIAL_SOL = 10.0;
const DUST_THRESHOLD = 1e-10;

export interface PaperPosition {
  mint: string;
  quantity: number;
  avgEntryPriceSol: number;
  totalCostSol: number;
  realizedPnlSol?: number;
  realizedPnlPct?: number;
  lastSoldAt?: number;
  lastUpdatedAt: number;
}

interface PaperWalletData {
  solBalance: number;
  tokenBalances: Record<string, number>;
  tokenAccounts?: Record<string, boolean>;
  positions: Record<string, PaperPosition>;
  address: string;
}

interface PaperWalletState extends PaperWalletData {
  setSolBalance: (sol: number) => void;
  adjustSolBalance: (delta: number) => void;
  setTokenBalance: (mint: string, balance: number) => void;
  adjustTokenBalance: (mint: string, delta: number) => void;
  hasTokenAccount: (mint: string) => boolean;
  createTokenAccount: (mint: string) => void;
  recordBuyPosition: (mint: string, tokenQuantity: number, totalCostSol: number) => void;
  recordSellPosition: (mint: string, tokenQuantity: number, proceedsSol?: number) => void;
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
      tokenAccounts: {},
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
        tokenAccounts: parsed.tokenAccounts && typeof parsed.tokenAccounts === 'object' ? parsed.tokenAccounts : {},
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
    tokenAccounts: {},
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
      tokenAccounts: data.tokenAccounts,
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
      const nextTokens = { ...get().tokenBalances, [mint]: clamped <= DUST_THRESHOLD ? 0 : clamped };
      const nextTokenAccounts = { ...(get().tokenAccounts || {}) };
      if (clamped > DUST_THRESHOLD) {
        nextTokenAccounts[mint] = true;
      }
      const nextPositions = { ...get().positions };
      if (clamped <= DUST_THRESHOLD && nextPositions[mint]) {
        nextPositions[mint] = {
          ...nextPositions[mint],
          quantity: 0,
          totalCostSol: 0,
          lastUpdatedAt: Date.now(),
        };
      }
      set({ tokenBalances: nextTokens, tokenAccounts: nextTokenAccounts, positions: nextPositions });
      persistData({ ...get(), tokenBalances: nextTokens, tokenAccounts: nextTokenAccounts, positions: nextPositions });
      sync();
    },

    adjustTokenBalance: (mint, delta) => {
      const current = get().tokenBalances[mint] || 0;
      const next = Math.max(0, current + delta);
      const nextTokens = { ...get().tokenBalances, [mint]: next <= DUST_THRESHOLD ? 0 : next };
      const nextTokenAccounts = { ...(get().tokenAccounts || {}) };
      if (next > DUST_THRESHOLD) {
        nextTokenAccounts[mint] = true;
      }
      const nextPositions = { ...get().positions };
      if (next <= DUST_THRESHOLD && nextPositions[mint]) {
        nextPositions[mint] = {
          ...nextPositions[mint],
          quantity: 0,
          totalCostSol: 0,
          lastUpdatedAt: Date.now(),
        };
      }
      set({ tokenBalances: nextTokens, tokenAccounts: nextTokenAccounts, positions: nextPositions });
      persistData({ ...get(), tokenBalances: nextTokens, tokenAccounts: nextTokenAccounts, positions: nextPositions });
      sync();
    },

    hasTokenAccount: (mint: string) => {
      return Boolean(get().tokenAccounts?.[mint] || (get().tokenBalances[mint] || 0) > 0);
    },

    createTokenAccount: (mint: string) => {
      const nextTokenAccounts = { ...(get().tokenAccounts || {}), [mint]: true };
      set({ tokenAccounts: nextTokenAccounts });
      persistData({ ...get(), tokenAccounts: nextTokenAccounts });
    },

    recordBuyPosition: (mint, tokenQuantity, totalCostSol) => {
      if (tokenQuantity <= 0 || totalCostSol <= 0) {
        console.warn(`[PaperWalletStore] Invalid buy position: qty=${tokenQuantity}, cost=${totalCostSol}`);
        return;
      }

      const existing = get().positions[mint];
      let updatedPos: PaperPosition;

      if (existing && existing.quantity > DUST_THRESHOLD) {
        const newQty = existing.quantity + tokenQuantity;
        const newCost = existing.totalCostSol + totalCostSol;
        updatedPos = {
          ...existing,
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
          realizedPnlSol: existing?.realizedPnlSol || 0,
          realizedPnlPct: existing?.realizedPnlPct || 0,
          lastUpdatedAt: Date.now(),
        };
      }

      const nextTokens = { ...get().tokenBalances, [mint]: updatedPos.quantity };
      const nextTokenAccounts = { ...(get().tokenAccounts || {}), [mint]: true };
      const nextPositions = { ...get().positions, [mint]: updatedPos };
      set({ tokenBalances: nextTokens, tokenAccounts: nextTokenAccounts, positions: nextPositions });
      persistData({ ...get(), tokenBalances: nextTokens, tokenAccounts: nextTokenAccounts, positions: nextPositions });
      sync();
    },

    recordSellPosition: (mint, tokenQuantitySold, proceedsSol?: number) => {
      if (tokenQuantitySold <= 0) return;
      const existing = get().positions[mint];
      const currentBal = get().tokenBalances[mint] || 0;
      const nextBal = Math.max(0, currentBal - tokenQuantitySold);

      const nextTokens = { ...get().tokenBalances, [mint]: nextBal <= DUST_THRESHOLD ? 0 : nextBal };
      const nextPositions = { ...get().positions };

      // Calculate realized PnL on the sold portion
      let realizedPnlSol = existing?.realizedPnlSol || 0;
      let realizedPnlPct = existing?.realizedPnlPct || 0;

      if (existing && existing.quantity > DUST_THRESHOLD) {
        const soldFraction = Math.min(1, tokenQuantitySold / existing.quantity);
        const soldCostBasis = existing.totalCostSol * soldFraction;
        if (proceedsSol !== undefined && proceedsSol >= 0) {
          const tradePnlSol = proceedsSol - soldCostBasis;
          const tradePnlPct = soldCostBasis > 0 ? (tradePnlSol / soldCostBasis) * 100 : 0;
          realizedPnlSol += tradePnlSol;
          realizedPnlPct = tradePnlPct;
        }
      }

      if (nextBal <= DUST_THRESHOLD) {
        if (existing) {
          nextPositions[mint] = {
            ...existing,
            quantity: 0,
            totalCostSol: 0,
            realizedPnlSol,
            realizedPnlPct,
            lastSoldAt: Date.now(),
            lastUpdatedAt: Date.now(),
          };
        }
        nextTokens[mint] = 0;
      } else if (existing) {
        const remainingFraction = nextBal / existing.quantity;
        nextPositions[mint] = {
          ...existing,
          quantity: nextBal,
          totalCostSol: existing.totalCostSol * remainingFraction,
          realizedPnlSol,
          realizedPnlPct,
          lastSoldAt: Date.now(),
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
        tokenAccounts: {},
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
