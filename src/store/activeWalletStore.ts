import { create } from 'zustand';
import { Keypair } from '@solana/web3.js';
import { getSavedSessionKeypair, saveSessionKeypair } from '../utils/keypairUtils';
import { useBalanceStore } from './balanceStore';
import { DEFAULT_DEVNET_TRADING_ADDRESS } from '../constants/solana';

import { useTradingEnvironmentStore } from './tradingEnvironmentStore';

export interface ActiveWallet {
    address: string;
    keypair: Keypair | null;
    network: 'devnet' | 'mainnet';
    source: 'session' | 'connected';
    version: number;
}

export interface SwitchActiveWalletParams {
    keypair: Keypair | null;
    address?: string;
    network?: 'devnet' | 'mainnet';
    source: 'session' | 'connected';
    clearStorage?: boolean;
}

interface ActiveWalletState {
    activeWallet: ActiveWallet | null;
    setActiveWallet: (wallet: ActiveWallet | null) => void;
    switchActiveWallet: (params: SwitchActiveWalletParams) => void;
}

const getInitialActiveWallet = (): ActiveWallet | null => {
    try {
        const restoredKp = getSavedSessionKeypair();
        const initialNetwork = (typeof window !== 'undefined' && (localStorage.getItem('app_trading_network') as 'devnet' | 'mainnet')) || 'devnet';
        if (restoredKp) {
            const address = restoredKp.publicKey.toBase58();
            // Ensure balance store address is synced immediately
            useBalanceStore.getState().setWalletAddress(address);
            setTimeout(() => {
              import('../services/WalletBalanceService').then(m => {
                m.walletBalanceService.refreshNow(address);
              });
            }, 0);
            return {
                address,
                keypair: restoredKp,
                network: initialNetwork,
                source: 'session',
                version: 1
            };
        } else if (initialNetwork === 'devnet') {
            const address = DEFAULT_DEVNET_TRADING_ADDRESS;
            useBalanceStore.getState().setWalletAddress(address);
            setTimeout(() => {
              import('../services/WalletBalanceService').then(m => {
                m.walletBalanceService.refreshNow(address);
              });
            }, 0);
            return {
                address,
                keypair: null,
                network: 'devnet',
                source: 'connected',
                version: 1
            };
        }
    } catch (e) {
        console.warn('[ActiveWalletStore] Failed to restore session keypair on init:', e);
    }
    return null;
};

export const useActiveWalletStore = create<ActiveWalletState>((set, get) => ({
    activeWallet: getInitialActiveWallet(),
    
    setActiveWallet: (wallet) => set({ activeWallet: wallet }),

    switchActiveWallet: (params) => {
        const { keypair, source, clearStorage } = params;
        const envNetwork = useTradingEnvironmentStore.getState().network || 'devnet';
        const network = params.network || envNetwork;
        const address = params.address || (keypair ? keypair.publicKey.toBase58() : '');
        
        if (source === 'session') {
           if (keypair) {
             saveSessionKeypair(keypair, network);
           } else if (clearStorage) {
             saveSessionKeypair(null);
           }
        }

        // Clear previous balance to prevent displaying stale balance for the new wallet
        useBalanceStore.getState().setWalletAddress(address || null);

        if (!address && !keypair) {
             set({ activeWallet: null });
             return;
        }

        const current = get().activeWallet;
        const newVersion = current ? current.version + 1 : 1;
        
        const newWallet: ActiveWallet = {
            address,
            keypair,
            network,
            source,
            version: newVersion
        };
        
        set({ activeWallet: newWallet });

        // Trigger immediate authoritative sync for the new wallet
        setTimeout(() => {
          import('../services/WalletBalanceService').then(m => {
            m.walletBalanceService.refreshNow(address);
          });
        }, 0);
    }
}));
