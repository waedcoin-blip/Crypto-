import { create } from 'zustand';

export interface SimulatedPosition {
  mint: string;
  symbol: string;
  entryPriceSol: number;
  entryAmountSol: number;
  tokenAmount: number;
  tokenDecimals: number;
  entryTime: number;
  takeProfitPct: number;
  stopLossPct: number;
  exitProfile: string;
  entrySignature: string;
}

export interface TradeHistoryEvent {
  type: 'BUY' | 'SELL';
  mint: string;
  symbol: string;
  timestamp: number;
  solAmount: number;
  tokenAmount: number;
  priceSol: number;
  pnlSol?: number;
  pnlPct?: number;
  signature: string;
}

interface SimulationLedgerState {
  cashSol: number;
  realizedPnlSol: number;
  openPositions: Record<string, SimulatedPosition>;
  tradeHistory: TradeHistoryEvent[];
  
  initialize: (initialSol: number) => void;
  recordBuy: (
    mint: string,
    symbol: string,
    costSol: number,
    tokenAmount: number,
    tokenDecimals: number,
    takeProfitPct: number,
    stopLossPct: number,
    exitProfile: string
  ) => void;
  recordSell: (
    mint: string,
    proceedsSol: number,
    tokenAmount: number
  ) => void;
}

export const useSimulationLedger = create<SimulationLedgerState>((set, get) => ({
  cashSol: 0,
  realizedPnlSol: 0,
  openPositions: {},
  tradeHistory: [],

  initialize: (initialSol: number) => {
    set({
      cashSol: initialSol,
      realizedPnlSol: 0,
      openPositions: {},
      tradeHistory: []
    });
  },

  recordBuy: (mint, symbol, costSol, tokenAmount, tokenDecimals, takeProfitPct, stopLossPct, exitProfile) => {
    set((state) => {
      // Create signature for the event
      const signature = 'sim-buy-' + Date.now();
      
      const newPosition: SimulatedPosition = {
        mint,
        symbol,
        entryPriceSol: costSol / tokenAmount,
        entryAmountSol: costSol,
        tokenAmount,
        tokenDecimals,
        entryTime: Date.now(),
        takeProfitPct,
        stopLossPct,
        exitProfile,
        entrySignature: signature
      };

      const event: TradeHistoryEvent = {
        type: 'BUY',
        mint,
        symbol,
        timestamp: Date.now(),
        solAmount: costSol,
        tokenAmount,
        priceSol: costSol / tokenAmount,
        signature
      };

      return {
        cashSol: state.cashSol - costSol,
        openPositions: {
          ...state.openPositions,
          [mint]: newPosition
        },
        tradeHistory: [event, ...state.tradeHistory]
      };
    });
  },

  recordSell: (mint, proceedsSol, tokenAmount) => {
    set((state) => {
      const position = state.openPositions[mint];
      if (!position) return state; // Should not happen

      const signature = 'sim-sell-' + Date.now();
      const pnlSol = proceedsSol - position.entryAmountSol;
      const pnlPct = (pnlSol / position.entryAmountSol) * 100;

      const event: TradeHistoryEvent = {
        type: 'SELL',
        mint,
        symbol: position.symbol,
        timestamp: Date.now(),
        solAmount: proceedsSol,
        tokenAmount,
        priceSol: proceedsSol / tokenAmount,
        pnlSol,
        pnlPct,
        signature
      };

      const { [mint]: closed, ...remainingPositions } = state.openPositions;

      return {
        cashSol: state.cashSol + proceedsSol,
        realizedPnlSol: state.realizedPnlSol + pnlSol,
        openPositions: remainingPositions,
        tradeHistory: [event, ...state.tradeHistory]
      };
    });
  }
}));
