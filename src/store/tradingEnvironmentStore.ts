// src/store/tradingEnvironmentStore.ts
import { create } from 'zustand';
import { getNetworkConfig, TradingNetwork } from '../config/network';
import { useBalanceStore } from './balanceStore';
import { useActiveWalletStore } from './activeWalletStore';
import { DEFAULT_DEVNET_TRADING_ADDRESS } from '../constants/solana';

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
        localStorage.setItem('trade_mode', network);
        localStorage.setItem('is_live_trading', network === 'mainnet' ? 'true' : 'false');
        
        useBalanceStore.getState().setNetwork(network);

        const activeWalletState = useActiveWalletStore.getState();
        if (activeWalletState.activeWallet) {
          const newAddress = network === 'devnet' && !activeWalletState.activeWallet.keypair
            ? DEFAULT_DEVNET_TRADING_ADDRESS
            : activeWalletState.activeWallet.address;

          activeWalletState.setActiveWallet({
            ...activeWalletState.activeWallet,
            address: newAddress,
            network: network,
            version: activeWalletState.activeWallet.version + 1,
          });

          useBalanceStore.getState().setWalletAddress(newAddress);
          setTimeout(() => {
            import('../services/WalletBalanceService').then(m => {
              m.walletBalanceService.refreshNow(newAddress);
            });
          }, 0);
        } else if (network === 'devnet') {
          activeWalletState.switchActiveWallet({
            keypair: null,
            address: DEFAULT_DEVNET_TRADING_ADDRESS,
            network: 'devnet',
            source: 'connected',
          });
        }

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
