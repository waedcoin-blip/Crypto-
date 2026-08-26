// src/store/balanceStore.ts
import { create } from 'zustand';

export type BalanceNetwork = 'devnet' | 'mainnet';

export interface BalanceState {
  network: BalanceNetwork;
  walletAddress: string | null;

  // On-Chain Wallet Balance (RPC queried for Devnet/Mainnet)
  onChainSolBalance: number | null;
  onChainAvailableSol: number | null;
  onChainReservedSol: number;
  onChainLastUpdated: number | null;
  onChainStatus: 'idle' | 'loading' | 'live' | 'stale' | 'error';
  onChainError: string | null;

  // Backward-compatible fields
  solBalance: number | null;
  availableSolBalance: number | null;
  reservedSol: number;
  lastUpdated: number | null;
  status: 'idle' | 'loading' | 'live' | 'stale' | 'error';
  error: string | null;

  // Persistent Devnet paper trading SOL balance (default 10.0 SOL)
  paperSolBalance: number;
  adjustPaperSol: (deltaSol: number) => void;
  setPaperSol: (solAmount: number) => void;

  setNetwork: (network: BalanceNetwork) => void;
  setWalletAddress: (address: string | null) => void;

  setOnChainBalance: (balance: {
    solBalance: number;
    availableSolBalance?: number;
    reservedSol?: number;
  }) => void;

  setBalance: (balance: {
    solBalance: number;
    availableSolBalance?: number;
    reservedSol?: number;
  }) => void;

  setStatus: (
    status: BalanceState['status'],
    error?: string | null
  ) => void;

  reset: () => void;

  tokenBalances: Record<string, number>;
  setTokenBalances: (balances: Record<string, number>) => void;
  setTokenBalance: (mint: string, balance: number) => void;
}

const initialState = {
  network: 'devnet' as BalanceNetwork,
  walletAddress: null,
  
  onChainSolBalance: null,
  onChainAvailableSol: null,
  onChainReservedSol: 0.005,
  onChainLastUpdated: null,
  onChainStatus: 'idle' as const,
  onChainError: null,

  solBalance: null,
  availableSolBalance: null,
  reservedSol: 0.005,
  lastUpdated: null,
  status: 'idle' as const,
  error: null,
  paperSolBalance: 10.0,
  tokenBalances: {},
};

export const useBalanceStore = create<BalanceState>((set) => ({
  ...initialState,

  adjustPaperSol: (deltaSol) =>
    set((state) => {
      const nextPaper = Math.max(0, state.paperSolBalance + deltaSol);
      const isDevnet = state.network === 'devnet';
      const effectiveSol = isDevnet && (state.onChainSolBalance === null || state.onChainSolBalance < 0.05)
        ? nextPaper
        : (state.onChainSolBalance ?? nextPaper);
      const effectiveAvail = Math.max(0, effectiveSol - state.reservedSol);

      return {
        paperSolBalance: nextPaper,
        solBalance: effectiveSol,
        availableSolBalance: effectiveAvail,
        onChainSolBalance: isDevnet && (state.onChainSolBalance === null || state.onChainSolBalance < 0.05) ? nextPaper : state.onChainSolBalance,
        onChainAvailableSol: isDevnet && (state.onChainSolBalance === null || state.onChainSolBalance < 0.05) ? effectiveAvail : state.onChainAvailableSol,
        lastUpdated: Date.now(),
      };
    }),

  setPaperSol: (solAmount) =>
    set((state) => {
      const nextPaper = Math.max(0, solAmount);
      const isDevnet = state.network === 'devnet';
      const effectiveSol = isDevnet && (state.onChainSolBalance === null || state.onChainSolBalance < 0.05)
        ? nextPaper
        : (state.onChainSolBalance ?? nextPaper);
      const effectiveAvail = Math.max(0, effectiveSol - state.reservedSol);

      return {
        paperSolBalance: nextPaper,
        solBalance: effectiveSol,
        availableSolBalance: effectiveAvail,
        onChainSolBalance: isDevnet && (state.onChainSolBalance === null || state.onChainSolBalance < 0.05) ? nextPaper : state.onChainSolBalance,
        onChainAvailableSol: isDevnet && (state.onChainSolBalance === null || state.onChainSolBalance < 0.05) ? effectiveAvail : state.onChainAvailableSol,
        lastUpdated: Date.now(),
      };
    }),

  setNetwork: (network) =>
    set({
      network,
      onChainSolBalance: null,
      onChainAvailableSol: null,
      onChainLastUpdated: null,
      onChainStatus: 'idle',
      onChainError: null,
      solBalance: null,
      availableSolBalance: null,
      lastUpdated: null,
      status: 'idle',
      error: null,
    }),

  setWalletAddress: (walletAddress) =>
    set((state) => {
      if (state.walletAddress === walletAddress) return state;
      return {
        walletAddress,
        onChainSolBalance: null,
        onChainAvailableSol: null,
        onChainLastUpdated: null,
        onChainStatus: walletAddress ? 'loading' : 'idle',
        onChainError: null,
        solBalance: null,
        availableSolBalance: null,
        lastUpdated: null,
        status: walletAddress ? 'loading' : 'idle',
        error: null,
      };
    }),

  setOnChainBalance: ({
    solBalance,
    availableSolBalance,
    reservedSol = 0.005,
  }) =>
    set((state) => {
      const isDevnet = state.network === 'devnet';
      const effectiveSol = isDevnet && solBalance < 0.05
        ? state.paperSolBalance
        : solBalance;
      const newAvail = availableSolBalance ?? Math.max(0, effectiveSol - reservedSol);

      return {
        onChainSolBalance: effectiveSol,
        onChainReservedSol: reservedSol,
        onChainAvailableSol: newAvail,
        onChainLastUpdated: Date.now(),
        onChainStatus: 'live',
        onChainError: null,
        solBalance: effectiveSol,
        reservedSol,
        availableSolBalance: newAvail,
        lastUpdated: Date.now(),
        status: 'live',
        error: null,
      };
    }),

  setBalance: ({
    solBalance,
    availableSolBalance,
    reservedSol = 0.005,
  }) =>
    set((state) => {
      const newAvail = availableSolBalance ?? Math.max(0, solBalance - reservedSol);
      if (
        state.solBalance === solBalance &&
        state.availableSolBalance === newAvail &&
        state.reservedSol === reservedSol &&
        state.status === 'live'
      ) {
        return state;
      }
      return {
        solBalance,
        reservedSol,
        availableSolBalance: newAvail,
        lastUpdated: Date.now(),
        status: 'live',
        error: null,
      };
    }),

  setStatus: (status, error = null) =>
    set({
      status,
      onChainStatus: status,
      error,
      onChainError: error,
    }),

  setTokenBalances: (balances) =>
    set({
      tokenBalances: balances,
      lastUpdated: Date.now(),
      onChainLastUpdated: Date.now(),
    }),

  setTokenBalance: (mint, balance) =>
    set((state) => ({
      tokenBalances: { ...state.tokenBalances, [mint]: balance },
      lastUpdated: Date.now(),
      onChainLastUpdated: Date.now(),
    })),

  reset: () =>
    set({
      ...initialState,
    }),
}));

/**
 * Authoritative trading balance retriever
 */
export function getTradingBalance(): number {
  const state = useBalanceStore.getState();

  const avail = state.onChainAvailableSol ?? state.availableSolBalance;
  if (avail === null) {
    throw new Error('On-chain wallet balance is not available');
  }

  if (state.onChainStatus !== 'live' && state.status !== 'live') {
    throw new Error('On-chain wallet balance is stale or unavailable');
  }

  return avail;
}

/**
 * Asserts sufficient live balance prior to trade execution
 */
export async function assertTradeBalance(requiredSol: number): Promise<void> {
  const state = useBalanceStore.getState();

  if (state.onChainStatus !== 'live' && state.status !== 'live') {
    throw new Error('Trading blocked: on-chain wallet balance is not live');
  }

  const avail = state.onChainAvailableSol ?? state.availableSolBalance;
  if (avail === null) {
    throw new Error('Trading blocked: on-chain wallet balance unavailable');
  }

  if (avail < requiredSol) {
    throw new Error(`Insufficient ${state.network.toUpperCase()} SOL balance (Available: ${avail.toFixed(4)} SOL, Required: ${requiredSol.toFixed(4)} SOL)`);
  }
}

/**
 * Asserts the execution environment matches the active RPC cluster
 */
export function assertExecutionEnvironment(
  network: 'devnet' | 'mainnet',
  rpcUrl: string
): void {
  if (network === 'devnet' && !rpcUrl.includes('devnet')) {
    throw new Error('BLOCKED: Devnet execution requires Devnet RPC');
  }

  if (network === 'mainnet' && rpcUrl.includes('devnet')) {
    throw new Error('BLOCKED: Mainnet execution cannot use Devnet RPC');
  }
}

