// src/context/TradeModeContext.tsx
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { TradeManager, TradeMode } from '../services/TradeManager';

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
    manager.switchMode(m);
    setModeState(m);
  }, [manager]);

  useEffect(() => {
    if (mode !== 'paper') return;
    const id = setInterval(() => manager.save(), 10000);
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
    return {
      mode: (localStorage.getItem('trade_mode') as TradeMode) || 'paper',
      setMode: (m: TradeMode) => {
        localStorage.setItem('trade_mode', m);
        window.location.reload();
      },
      manager: null as unknown as TradeManager,
    };
  }
  return ctx;
};
