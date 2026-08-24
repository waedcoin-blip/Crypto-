import { create } from 'zustand';
import { Keypair } from '@solana/web3.js';
import { getSavedSessionKeypair, saveSessionKeypair } from '../utils/keypairUtils';
import { useBalanceStore } from './balanceStore';

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
}

interface ActiveWalletState {
    activeWallet: ActiveWallet | null;
    setActiveWallet: (wallet: ActiveWallet | null) => void;
    switchActiveWallet: (params: SwitchActiveWalletParams) => void;
}

export const useActiveWalletStore = create<ActiveWalletState>((set, get) => ({
    activeWallet: null,
    
    setActiveWallet: (wallet) => set({ activeWallet: wallet }),

    switchActiveWallet: (params) => {
        const { keypair, source } = params;
        const envNetwork = useTradingEnvironmentStore.getState().network || 'devnet';
        const network = params.network || envNetwork;
        const address = params.address || (keypair ? keypair.publicKey.toBase58() : '');
        
        if (source === 'session') {
           saveSessionKeypair(keypair);
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
