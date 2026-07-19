import { create } from 'zustand';
import { ScannedToken } from '../services/tokenScanner';

export interface SimPosition {
  tokenAddress: string;
  symbol: string;
  name: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  amountSol: number;
  entryTime: number;
  profitPercent: number;
  signalEmitted: boolean;
  // Token metadata for passing to SimRealPage
  liquidityUsd: number;
  volume24h: number;
  dexId: string;
  pairAddress: string;
}

interface SimulationStore {
  positions: Record<string, SimPosition>;
  closedPositions: SimPosition[];

  // Open a new simulation position
  openPosition: (token: ScannedToken, amountSol: number) => void;

  // Update current price for a tracked position
  updatePrice: (tokenAddress: string, currentPriceUsd: number) => void;

  // Close a position (manual or signal-triggered)
  closePosition: (tokenAddress: string, reason: string) => void;

  // Mark that signal was emitted for this position
  markSignaled: (tokenAddress: string) => void;

  // Check if position is already open
  hasPosition: (tokenAddress: string) => boolean;

  // Get all active positions as array
  getActivePositions: () => SimPosition[];
}

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  positions: {},
  closedPositions: [],

  openPosition: (token, amountSol) => {
    if (get().positions[token.address]) return; // already open

    const position: SimPosition = {
      tokenAddress: token.address,
      symbol: token.symbol,
      name: token.name,
      entryPriceUsd: token.priceUsd,
      currentPriceUsd: token.priceUsd,
      amountSol,
      entryTime: Date.now(),
      profitPercent: 0,
      signalEmitted: false,
      liquidityUsd: token.liquidityUsd,
      volume24h: token.volume24h,
      dexId: token.dexId,
      pairAddress: token.pairAddress,
    };

    set(state => ({
      positions: {
        ...state.positions,
        [token.address]: position,
      },
    }));

    console.log(
      `[Sim] Opened: ${token.symbol} @ $${token.priceUsd.toFixed(8)} ` +
      `(${amountSol} SOL)`
    );
  },

  updatePrice: (tokenAddress, currentPriceUsd) => {
    set(state => {
      const pos = state.positions[tokenAddress];
      if (!pos) return state;

      const profitPercent =
        ((currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;

      return {
        positions: {
          ...state.positions,
          [tokenAddress]: {
            ...pos,
            currentPriceUsd,
            profitPercent,
          },
        },
      };
    });
  },

  closePosition: (tokenAddress, reason) => {
    set(state => {
      const pos = state.positions[tokenAddress];
      if (!pos) return state;

      const { [tokenAddress]: removed, ...rest } = state.positions;
      console.log(
        `[Sim] Closed: ${pos.symbol} @ ${pos.profitPercent.toFixed(2)}% ` +
        `(${reason})`
      );

      return {
        positions: rest,
        closedPositions: [...state.closedPositions, pos].slice(-50), // keep last 50
      };
    });
  },

  markSignaled: (tokenAddress) => {
    set(state => {
      const pos = state.positions[tokenAddress];
      if (!pos) return state;
      return {
        positions: {
          ...state.positions,
          [tokenAddress]: { ...pos, signalEmitted: true },
        },
      };
    });
  },

  hasPosition: (tokenAddress) => {
    return !!get().positions[tokenAddress];
  },

  getActivePositions: () => {
    return Object.values(get().positions);
  },
}));
