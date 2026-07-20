import { create } from 'zustand';
import { TokenMetric, TelemetryAlert, Trade, SniperTrade } from '../types';
import { Keypair } from '@solana/web3.js';

export interface ActivePositionData {
    boughtAt: number; 
    amount: number;
    tokenQuantityRaw?: string; 
    symbol: string; 
    entryPrice?: number; 
    entryPriceSol?: number;
    solSpent?: number;
    peakPnLPct?: number;
    initialTokens?: number;
    soldPartial?: boolean;
    entryFeesSol?: number;
    hasPulled10x?: boolean; 
    hasPulledPrincipal?: boolean; 
    recoveryMode?: boolean;
    triggersDisabled?: boolean;
    currentStage?: any;
    initialMoonbagSizeStr?: string;
    isManualSellTriggered?: boolean;
    simRealBought?: boolean;
    simRealBoughtPriceSol?: number;
    simRealAmountTokens?: number;
    simRealSolSpent?: number;
    simRealBoughtTime?: number;
}

interface AppState {
  // Settings
  autoSniperEnabled: boolean;
  isLiveTrading: boolean;
  buyAmountSol: number;
  minTakeProfit: number;
  maxTakeProfit: number;
  bondingCurveTakeProfit: number;
  moonbagStrategy: boolean;
  stopLoss: number;
  maxPositions: number;
  slippage: number;
  telegramBotToken: string;
  telegramChatId: string;
  hardenedMaxRiskScore: number;
  hardenedLiquidityRatio: number;
  hardenedMaxDevOwnership: number;
  
  // Scanners / Metrics
  isMonitoring: boolean;
  tokenMetrics: Record<string, TokenMetric>;
  telemetryAlerts: TelemetryAlert[];
  telemetryBits: boolean[];
  trades: Trade[];
  mySniperTrades: SniperTrade[];
  activePositions: Record<string, ActivePositionData>;
  monitoredWallets: {id: string, address: string, label: string}[];
  simulationBalance: number;
  simRealBalance: number;
  simRealTrades: SniperTrade[];
  sessionWallet: Keypair | null;
  jupiterLogs: { id: string; timestamp: number; type: 'QUOTE' | 'SWAP' | 'ERROR' | 'INFO'; message: string; details?: any }[];

  // Actions
  setAutoSniperEnabled: (val: boolean) => void;
  setIsLiveTrading: (val: boolean) => void;
  setTokenMetrics: (fn: (prev: Record<string, TokenMetric>) => Record<string, TokenMetric>) => void;
  setTrades: (fn: (prev: Trade[]) => Trade[]) => void;
  addTelemetryAlert: (alert: TelemetryAlert) => void;
  setTelemetryAlerts: (fn: (prev: TelemetryAlert[]) => TelemetryAlert[]) => void;
  setTelemetryBits: (bits: boolean[]) => void;
  updateActivePositions: (fn: (prev: Record<string, ActivePositionData>) => Record<string, ActivePositionData>) => void;
  setSimulationBalance: (fn: (prev: number) => number) => void;
  setSimRealBalance: (fn: (prev: number) => number) => void;
  setMySniperTrades: (fn: (prev: SniperTrade[]) => SniperTrade[]) => void;
  setSimRealTrades: (fn: (prev: SniperTrade[]) => SniperTrade[]) => void;
  setSessionWallet: (wallet: Keypair | null) => void;
  setIsMonitoring: (val: boolean) => void;
  addJupiterLog: (log: Omit<{ id: string; timestamp: number; type: 'QUOTE' | 'SWAP' | 'ERROR' | 'INFO'; message: string; details?: any }, 'id' | 'timestamp'>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  autoSniperEnabled: false,
  isLiveTrading: false,
  buyAmountSol: Number(localStorage.getItem('app_buyAmountSol')) || 0.1,
  minTakeProfit: Number(localStorage.getItem('app_minTakeProfit')) || 25,
  maxTakeProfit: Number(localStorage.getItem('app_maxTakeProfit')) || 45,
  bondingCurveTakeProfit: Number(localStorage.getItem('app_bondingCurveTakeProfit')) || 25,
  moonbagStrategy: true,
  stopLoss: Number(localStorage.getItem('app_stopLoss')) || -30,
  maxPositions: Number(localStorage.getItem('app_maxPositions')) || 5,
  slippage: 1.0,
  telegramBotToken: localStorage.getItem('tg_bot_token') || '',
  telegramChatId: localStorage.getItem('tg_chat_id') || '',
  hardenedMaxRiskScore: Number(localStorage.getItem('hd_max_risk_score')) || 22,
  hardenedLiquidityRatio: Number(localStorage.getItem('hd_liquidity_ratio')) || 7,
  hardenedMaxDevOwnership: Number(localStorage.getItem('hd_max_dev_ownership')) || 80,

  isMonitoring: false,
  tokenMetrics: {},
  telemetryAlerts: [],
  telemetryBits: Array(12).fill(false),
  trades: [],
  mySniperTrades: (() => {
    try {
      const saved = localStorage.getItem('app_mySniperTrades');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  })(),
  activePositions: (() => {
    try {
      const saved = localStorage.getItem('app_activePositions');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  })(),
  monitoredWallets: [],
  simulationBalance: (() => {
    const saved = localStorage.getItem('app_simulationBalance_v4');
    if (saved) return Number(saved);
    const old = localStorage.getItem('app_simulationBalance');
    if (old === '10' || !old || Number(old) === 0.12) return 10.0;
    return Number(old);
  })(),
  simRealBalance: (() => {
    const saved = localStorage.getItem('app_simRealBalance');
    return saved ? Number(saved) : 10.0;
  })(),
  simRealTrades: (() => {
    try {
      const saved = localStorage.getItem('app_simRealTrades');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  })(),
  jupiterLogs: [],
  sessionWallet: null,

  setAutoSniperEnabled: (val) => set({ autoSniperEnabled: val }),
  setIsLiveTrading: (val) => set({ isLiveTrading: val }),
  setTokenMetrics: (fn) => set((state) => ({ ...state, tokenMetrics: fn(state.tokenMetrics) })),
  setTrades: (fn) => set((state) => ({ trades: fn(state.trades) })),
  addTelemetryAlert: (alert) => set((state) => ({ telemetryAlerts: [alert, ...state.telemetryAlerts.slice(0, 19)] })),
  setTelemetryAlerts: (fn) => set((state) => ({ telemetryAlerts: fn(state.telemetryAlerts) })),
  setTelemetryBits: (bits) => set({ telemetryBits: bits }),
  updateActivePositions: (fn) => set((state) => {
    const newPositions = fn(state.activePositions);
    localStorage.setItem('app_activePositions', JSON.stringify(newPositions));
    return { activePositions: newPositions };
  }),
  setSimulationBalance: (fn) => set((state) => {
    const val = fn(state.simulationBalance);
    localStorage.setItem('app_simulationBalance_v4', String(val));
    return { simulationBalance: val };
  }),
  setSimRealBalance: (fn) => set((state) => {
    const val = fn(state.simRealBalance);
    localStorage.setItem('app_simRealBalance', String(val));
    localStorage.setItem('app_simRealBalance_fallback', String(val));
    return { simRealBalance: val };
  }),
  setMySniperTrades: (fn) => set((state) => {
    const next = fn(state.mySniperTrades);
    localStorage.setItem('app_mySniperTrades', JSON.stringify(next));
    return { mySniperTrades: next };
  }),
  setSimRealTrades: (fn) => set((state) => {
    const next = fn(state.simRealTrades);
    localStorage.setItem('app_simRealTrades', JSON.stringify(next));
    return { simRealTrades: next };
  }),
  setSessionWallet: (wallet) => set({ sessionWallet: wallet }),
  setIsMonitoring: (val) => set({ isMonitoring: val }),
  addJupiterLog: (log) => set((state) => ({
    jupiterLogs: [{ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), ...log }, ...state.jupiterLogs].slice(0, 100)
  })),
}));
