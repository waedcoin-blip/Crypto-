// src/context/TradeModeContext.tsx
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { TradeManager, TradeMode } from '../services/TradeManager';
import { useAppStore } from '../store/appStore';
import { useBalanceStore } from '../store/balanceStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { TradingNetwork } from '../config/network';
import { walletBalanceService } from '../services/WalletBalanceService';

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
    const network: TradingNetwork = m === 'mainnet' ? 'mainnet' : 'devnet';
    localStorage.setItem('trade_mode', m);
    localStorage.setItem('app_trading_network', network);
    localStorage.setItem('is_live_trading', String(network === 'mainnet'));
    useAppStore.getState().setIsLiveTrading(network === 'mainnet');
    useBalanceStore.getState().setNetwork(network);
    walletBalanceService.updateNetwork(network);
    void useTradingEnvironmentStore.getState().setNetwork(network);
  }, [manager]);

  useEffect(() => {
    // Sync initial state on mount
    const savedMode = (localStorage.getItem('trade_mode') as TradeMode) || 'devnet';
    if (savedMode !== mode) {
      setMode(savedMode);
    }
  }, []);

  return (
    <Context.Provider value={{ mode, setMode, manager }}>
      {children}
    </Context.Provider>
  );
};

export const useTradeMode = () => {
  const ctx = useContext(Context);
  if (!ctx) {
    const savedMode = (localStorage.getItem('trade_mode') as TradeMode) || 'devnet';
    return {
      mode: savedMode,
      setMode: (m: TradeMode) => {
        const network: TradingNetwork = m === 'mainnet' ? 'mainnet' : 'devnet';
        localStorage.setItem('trade_mode', m);
        localStorage.setItem('app_trading_network', network);
        localStorage.setItem('is_live_trading', String(network === 'mainnet'));
        useAppStore.getState().setIsLiveTrading(network === 'mainnet');
        useBalanceStore.getState().setNetwork(network);
        walletBalanceService.updateNetwork(network);
        void useTradingEnvironmentStore.getState().setNetwork(network);
      },
      manager: null as unknown as TradeManager,
    };
  }
  return ctx;
};
