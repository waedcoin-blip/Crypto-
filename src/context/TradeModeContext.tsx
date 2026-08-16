// src/context/TradeModeContext.tsx
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { TradeManager, TradeMode } from '../services/TradeManager';
import { useAppStore } from '../store/appStore';
import { useBalanceStore } from '../store/balanceStore';

const Context = createContext<{
  mode: TradeMode;
  setMode: (m: TradeMode) => void;
  manager: TradeManager;
} | null>(null);

export const TradeModeProvider: React.FC<{
  manager: TradeManager;
  children: React.ReactNode;
}> = ({ manager, children }) => {
  const [mode, setModeState] = useState<TradeMode>(manager.mode);

  const setMode = useCallback((m: TradeMode) => {
    if (manager) {
      manager.switchMode(m);
    }
    setModeState(m);
    localStorage.setItem('trade_mode', m);
    localStorage.setItem('is_live_trading', String(m === 'real'));
    useAppStore.getState().setIsLiveTrading(m === 'real');
    useBalanceStore.getState().setTradeMode(m);
  }, [manager]);

  useEffect(() => {
    // Sync initial state on mount
    const savedMode = localStorage.getItem('trade_mode') as TradeMode;
    if (savedMode && (savedMode === 'real' || savedMode === 'paper')) {
      if (savedMode !== mode) {
        setMode(savedMode);
      }
    }
  }, []);

  useEffect(() => {
    if (mode !== 'paper') return;
    const id = setInterval(() => manager?.save(), 10000);
    return () => clearInterval(id);
  }, [mode, manager]);

  return (
    <Context.Provider value={{ mode, setMode, manager }}>
      {children}
    </Context.Provider>
  );
};

export const useTradeMode = () => {
  const ctx = useContext(Context);
  if (!ctx) {
    const savedMode = (localStorage.getItem('trade_mode') as TradeMode) || 'paper';
    return {
      mode: savedMode,
      setMode: (m: TradeMode) => {
        localStorage.setItem('trade_mode', m);
        localStorage.setItem('is_live_trading', String(m === 'real'));
        useAppStore.getState().setIsLiveTrading(m === 'real');
        useBalanceStore.getState().setTradeMode(m);
      },
      manager: null as unknown as TradeManager,
    };
  }
  return ctx;
};

