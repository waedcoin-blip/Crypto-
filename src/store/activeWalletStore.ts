import { create } from 'zustand';
import { Keypair } from '@solana/web3.js';
import { getSavedSessionKeypair, saveSessionKeypair } from '../utils/keypairUtils';
import { useBalanceStore } from './balanceStore';

export const DEFAULT_DEVNET_WALLET_ADDRESS = '7TbQubgZ4XeZWDexWJF3y6VpVJjd7r16XfAaRWmj2Zbg';

export interface ActiveWallet {
    address: string;
    keypair: Keypair | null;
    network: 'devnet' | 'mainnet';
    source: 'session' | 'connected';
    version: number;
}

interface ActiveWalletState {
    activeWallet: ActiveWallet | null;
    setActiveWallet: (wallet: ActiveWallet | null) => void;
    switchActiveWallet: (params: { keypair: Keypair | null; address?: string; network: 'devnet' | 'mainnet'; source: 'session' | 'connected' }) => void;
}

const savedSessionKp = getSavedSessionKeypair();
const initialNetwork = (typeof localStorage !== 'undefined' && localStorage.getItem('app_trading_network') === 'mainnet') ? 'mainnet' : 'devnet';
const initialAddress = savedSessionKp
  ? savedSessionKp.publicKey.toBase58()
  : (initialNetwork === 'devnet' ? DEFAULT_DEVNET_WALLET_ADDRESS : '');

const initialWallet: ActiveWallet | null = initialAddress ? {
  address: initialAddress,
  keypair: savedSessionKp,
  network: initialNetwork,
  source: 'session',
  version: 1
} : null;

export const useActiveWalletStore = create<ActiveWalletState>((set, get) => ({
    activeWallet: initialWallet,
    
    setActiveWallet: (wallet) => set({ activeWallet: wallet }),

    switchActiveWallet: (params) => {
        const { keypair, network, source } = params;
        const current = get().activeWallet;
        let address = params.address;

        if (!address) {
            if (current?.address && current.network === network) {
                address = current.address;
            } else if (keypair) {
                address = keypair.publicKey.toBase58();
            } else if (network === 'devnet') {
                address = DEFAULT_DEVNET_WALLET_ADDRESS;
            } else {
                address = '';
            }
        }

        if (source === 'session') {
           saveSessionKeypair(keypair);
        }

        // Clear previous balance to prevent displaying stale balance for the new wallet
        useBalanceStore.getState().setWalletAddress(address || null);

        if (!address && !keypair) {
             set({ activeWallet: null });
             return;
        }

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

