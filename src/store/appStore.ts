// src/store/appStore.ts
import { create } from 'zustand';
import { TelemetryAlert } from '../types';

// ==========================================
// TYPES
// ==========================================

export interface LogEvent {
  id: string;
  time: string;
  timestamp: number;
  msg: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'system';
  category?: string;
  count?: number;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
  read: boolean;
}

export type TradeMode = 'paper' | 'devnet' | 'mainnet';

// SAFE persisted UI settings (no secrets)
export interface PersistedSettings {
  tradeMode: TradeMode;
  autoSniperEnabled: boolean;
  buyAmountSol: number;
  minTakeProfit: number;
  maxTakeProfit: number;
  stopLoss: number;
  maxPositions: number;
  maxRebuyTimes: number;
  tradeOnlyOnce: boolean;
  slippageBps: number;
  retentionLimit: number;
}

export interface AppStoreState extends PersistedSettings {
  // ---- UI State ----
  logs: LogEvent[];
  notifications: Notification[];
  telemetryAlerts: TelemetryAlert[];

  // ---- Server-Mirrored State (backend is source of truth) ----
  positions: Record<string, any>;
  portfolioPnL: {
    totalUnrealizedSol: number;
    totalRealizedSol: number;
    totalCostSol: number;
    portfolioPnlPct: number;
  } | null;
  supervisorState: string;
  isConnected: boolean;

  // ---- Criteria Cache (hydrated from backend, never locally authoritative) ----
  criteria: Record<string, any>;

  // ---- Actions: Logging ----
  addLog: (msg: string, type?: LogEvent['type'], category?: string) => void;
  clearLogs: () => void;

  // ---- Actions: Notifications ----
  addNotification: (title: string, message: string, type?: Notification['type']) => void;
  markNotificationRead: (id: string) => void;

  // ---- Actions: Telemetry ----
  addTelemetryAlert: (alert: Omit<TelemetryAlert, 'id'>) => void;

  // ---- Actions: Settings ----
  setSettings: (settings: Partial<PersistedSettings>) => void;
  setTradeMode: (mode: TradeMode) => void;

  // ---- Actions: Server State (set by hooks, not by UI directly) ----
  setPositions: (positions: Record<string, any>) => void;
  setPortfolioPnL: (pnl: AppStoreState['portfolioPnL']) => void;
  setSupervisorState: (state: string) => void;
  setConnected: (connected: boolean) => void;
  setCriteria: (criteria: Record<string, any>) => void;

  // ==========================================
  // COMPATIBILITY ALIASES & SHIMS (safe for older callers)
  // ==========================================
  isLiveTrading: boolean;
  setIsLiveTrading: (isLive: boolean) => void;
  activePositions: Record<string, any>;
  updateActivePositions: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
  tokenMetrics: Record<string, any>;
  setTokenMetrics: (updater: ((prev: Record<string, any>) => Record<string, any>) | Record<string, any>) => void;
  trades: any[];
  setTrades: (updater: ((prev: any[]) => any[]) | any[]) => void;
  mySniperTrades: any[];
  setMySniperTrades: (updater: ((prev: any[]) => any[]) | any[]) => void;
  setTelemetryAlerts: (updater: ((prev: TelemetryAlert[]) => TelemetryAlert[]) | TelemetryAlert[]) => void;
  addJupiterLog: (log: any) => void;
  sessionWallet: any;
  setSessionWallet: (wallet: any) => void;
  setTradeOnlyOnce: (tradeOnlyOnce: boolean) => void;
  setMaxRebuyTimes: (maxRebuyTimes: number) => void;
  isMonitoring: boolean;
  setIsMonitoring: (isMonitoring: boolean) => void;
  monitoredWallets: string[];
}

// ==========================================
// SAFE PERSISTENCE (explicit whitelist, no secrets)
// ==========================================

const SETTINGS_KEY = 'arina_unified_settings_v1';

const SAFE_SETTINGS_KEYS: (keyof PersistedSettings)[] = [
  'tradeMode', 'autoSniperEnabled', 'buyAmountSol', 'minTakeProfit',
  'maxTakeProfit', 'stopLoss', 'maxPositions', 'maxRebuyTimes',
  'tradeOnlyOnce', 'slippageBps', 'retentionLimit',
];

const DEFAULT_SETTINGS: PersistedSettings = {
  tradeMode: 'paper',
  autoSniperEnabled: false,
  buyAmountSol: 0.1,
  minTakeProfit: 25,
  maxTakeProfit: 100,
  stopLoss: 15,
  maxPositions: 10,
  maxRebuyTimes: 3,
  tradeOnlyOnce: true,
  slippageBps: 250,
  retentionLimit: 500,
};

function loadPersistedSettings(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Only restore whitelisted keys (prevents accidental secret restoration)
    const safe: Partial<PersistedSettings> = {};
    for (const key of SAFE_SETTINGS_KEYS) {
      if (parsed[key] !== undefined) {
        (safe as any)[key] = parsed[key];
      }
    }
    return safe;
  } catch {
    return {};
  }
}

function persistSettings(state: AppStoreState): void {
  try {
    const safe: Partial<PersistedSettings> = {};
    for (const key of SAFE_SETTINGS_KEYS) {
      (safe as any)[key] = state[key];
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe));
  } catch {
    // Ignore persistence failures
  }
}

// ==========================================
// STORE
// ==========================================

export const useAppStore = create<AppStoreState>((set, get) => {
  const loaded = loadPersistedSettings();
  const initialMode = loaded.tradeMode || DEFAULT_SETTINGS.tradeMode;

  return {
    ...DEFAULT_SETTINGS,
    ...loaded,

    logs: [],
    notifications: [],
    telemetryAlerts: [],
    positions: {},
    portfolioPnL: null,
    supervisorState: 'STOPPED',
    isConnected: false,
    criteria: {},

    // Compatibility state
    isLiveTrading: initialMode === 'mainnet',
    setIsLiveTrading: (isLive) => {
      set({ isLiveTrading: isLive, tradeMode: isLive ? 'mainnet' : 'paper' });
      persistSettings(get() as AppStoreState);
    },
    activePositions: {},
    updateActivePositions: (updater) => set((state) => {
      const next = typeof updater === 'function' ? updater(state.activePositions) : updater;
      return { activePositions: next, positions: next };
    }),
    tokenMetrics: {},
    setTokenMetrics: (updater) => set((state) => ({
      tokenMetrics: typeof updater === 'function' ? updater(state.tokenMetrics) : updater,
    })),
    trades: [],
    setTrades: (updater) => set((state) => ({
      trades: typeof updater === 'function' ? updater(state.trades) : updater,
    })),
    mySniperTrades: [],
    setMySniperTrades: (updater) => set((state) => ({
      mySniperTrades: typeof updater === 'function' ? updater(state.mySniperTrades) : updater,
    })),
    setTelemetryAlerts: (updater) => set((state) => ({
      telemetryAlerts: typeof updater === 'function' ? updater(state.telemetryAlerts) : updater,
    })),
    addJupiterLog: (log) => {
      const msg = typeof log === 'string' ? log : (log?.message || JSON.stringify(log));
      get().addLog(`[JUPITER] ${msg}`, 'info', 'jupiter');
    },
    sessionWallet: null,
    setSessionWallet: (sessionWallet) => set({ sessionWallet }),
    setTradeOnlyOnce: (tradeOnlyOnce) => {
      set({ tradeOnlyOnce });
      persistSettings(get() as AppStoreState);
    },
    setMaxRebuyTimes: (maxRebuyTimes) => {
      set({ maxRebuyTimes });
      persistSettings(get() as AppStoreState);
    },
    isMonitoring: true,
    setIsMonitoring: (isMonitoring) => set({ isMonitoring }),
    monitoredWallets: [],

    // ---- Logging (deduplicates consecutive identical logs) ----
    addLog: (msg, type = 'info', category) => {
      const now = Date.now();
      set((state) => {
        const prev = state.logs;
        const last = prev[0];

        // Deduplicate consecutive identical messages
        if (last && last.msg === msg && last.type === type) {
          const updated = { ...last, count: (last.count || 1) + 1, timestamp: now };
          return { logs: [updated, ...prev.slice(1)] };
        }

        const entry: LogEvent = {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          time: new Date(now).toLocaleTimeString(),
          timestamp: now,
          msg,
          type,
          category,
          count: 1,
        };

        let next = [entry, ...prev];
        if (next.length > state.retentionLimit) {
          next = next.slice(0, state.retentionLimit);
        }
        return { logs: next };
      });
    },

    clearLogs: () => set({ logs: [] }),

    // ---- Notifications ----
    addNotification: (title, message, type = 'info') => {
      set((state) => ({
        notifications: [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title,
            message,
            type,
            timestamp: Date.now(),
            read: false,
          },
          ...state.notifications,
        ].slice(0, 50),
      }));
    },

    markNotificationRead: (id) => {
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
      }));
    },

    // ---- Telemetry Alerts ----
    addTelemetryAlert: (alert) => {
      set((state) => ({
        telemetryAlerts: [
          { ...alert, id: `${alert.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
          ...state.telemetryAlerts,
        ].slice(0, 100),
      }));
    },

    // ---- Settings ----
    setSettings: (settings) => {
      set((state) => ({ ...state, ...settings }));
      persistSettings(get() as AppStoreState);
    },

    setTradeMode: (mode) => {
      set({ tradeMode: mode, isLiveTrading: mode === 'mainnet' });
      persistSettings(get() as AppStoreState);
    },

    // ---- Server State Setters (called by hooks) ----
    setPositions: (positions) => set({ positions, activePositions: positions }),
    setPortfolioPnL: (portfolioPnL) => set({ portfolioPnL }),
    setSupervisorState: (supervisorState) => set({ supervisorState }),
    setConnected: (isConnected) => set({ isConnected }),
    setCriteria: (criteria) => set({ criteria }),
  };
});

// ==========================================
// MIGRATION SHIMS (backward compatibility)
// These let old components keep working during the transition.
// ==========================================

/** @deprecated Use useAppStore directly. Kept for migration compatibility. */
export const usePaperWalletStore = {
  getState: () => {
    const state = useAppStore.getState();
    return {
      network: state.tradeMode,
      // Paper balance now comes from backend via usePositions portfolio data
      solBalance: state.portfolioPnL?.totalCostSol ?? 0,
    };
  },
};

/** @deprecated Use useAppStore directly. Kept for migration compatibility. */
export const useTradingEnvironmentStore = {
  getState: () => {
    const state = useAppStore.getState();
    return {
      network: state.tradeMode,
      isLiveTrading: state.tradeMode === 'mainnet',
      autoSniperEnabled: state.autoSniperEnabled,
    };
  },
};
