// src/store/tradingEnvironmentStore.ts
import { create } from 'zustand';
import { getNetworkConfig, TradingNetwork } from '../config/network';
import { useBalanceStore } from './balanceStore';

interface TradingEnvironmentState {
  network: TradingNetwork;
  rpcUrl: string;
  wsUrl: string;
  switching: boolean;
  error: string | null;

  setNetwork: (network: TradingNetwork) => Promise<void>;
}

export const useTradingEnvironmentStore = create<TradingEnvironmentState>((set) => {
  const initialNetwork: TradingNetwork = 
    (localStorage.getItem('app_trading_network') as TradingNetwork) === 'mainnet' ? 'mainnet' : 'devnet';
  const initial = getNetworkConfig(initialNetwork);

  return {
    network: initialNetwork,
    rpcUrl: initial.rpcUrl,
    wsUrl: initial.wsUrl,
    switching: false,
    error: null,

    setNetwork: async (network) => {
      set({
        switching: true,
        error: null,
      });

      try {
        const config = getNetworkConfig(network);
        localStorage.setItem('app_trading_network', network);
        localStorage.setItem('trade_mode', network === 'mainnet' ? 'real' : 'devnet');
        localStorage.setItem('is_live_trading', network === 'mainnet' ? 'true' : 'false');
        
        useBalanceStore.getState().setNetwork(network);

        set({
          network,
          rpcUrl: config.rpcUrl,
          wsUrl: config.wsUrl,
          switching: false,
        });
      } catch (error) {
        set({
          switching: false,
          error:
            error instanceof Error
              ? error.message
              : 'Network switch failed',
        });

        throw error;
      }
    },
  };
});
