// src/store/balanceStore.ts
import { create } from 'zustand';

export type BalanceNetwork = 'devnet' | 'mainnet';

export interface BalanceState {
  network: BalanceNetwork;
  walletAddress: string | null;

  solBalance: number | null;
  availableSolBalance: number | null;

  reservedSol: number;
  lastUpdated: number | null;

  status: 'idle' | 'loading' | 'live' | 'stale' | 'error';
  error: string | null;

  setNetwork: (network: BalanceNetwork) => void;
  setWalletAddress: (address: string | null) => void;

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
}

const initialState = {
  network: 'devnet' as BalanceNetwork,
  walletAddress: null,
  solBalance: null,
  availableSolBalance: null,
  reservedSol: 0.005,
  lastUpdated: null,
  status: 'idle' as const,
  error: null,
};

export const useBalanceStore = create<BalanceState>((set) => ({
  ...initialState,

  setNetwork: (network) =>
    set({
      network,
      solBalance: null,
      availableSolBalance: null,
      lastUpdated: null,
      status: 'idle',
      error: null,
    }),

  setWalletAddress: (walletAddress) =>
    set({
      walletAddress,
      solBalance: null,
      availableSolBalance: null,
      lastUpdated: null,
      status: walletAddress ? 'loading' : 'idle',
      error: null,
    }),

  setBalance: ({
    solBalance,
    availableSolBalance,
    reservedSol = 0.005,
  }) =>
    set({
      solBalance,
      reservedSol,
      availableSolBalance:
        availableSolBalance ??
        Math.max(0, solBalance - reservedSol),
      lastUpdated: Date.now(),
      status: 'live',
      error: null,
    }),

  setStatus: (status, error = null) =>
    set({
      status,
      error,
    }),

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

  if (state.availableSolBalance === null) {
    throw new Error('Wallet balance is not available');
  }

  if (state.status !== 'live') {
    throw new Error('Wallet balance is stale or unavailable');
  }

  return state.availableSolBalance;
}

/**
 * Asserts sufficient live on-chain balance prior to trade execution
 */
export async function assertTradeBalance(requiredSol: number): Promise<void> {
  const state = useBalanceStore.getState();

  if (state.status !== 'live') {
    throw new Error('Trading blocked: wallet balance is not live');
  }

  if (state.availableSolBalance === null) {
    throw new Error('Trading blocked: wallet balance unavailable');
  }

  if (state.availableSolBalance < requiredSol) {
    throw new Error(`Insufficient ${state.network.toUpperCase()} SOL balance (Available: ${state.availableSolBalance.toFixed(4)} SOL, Required: ${requiredSol.toFixed(4)} SOL)`);
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
