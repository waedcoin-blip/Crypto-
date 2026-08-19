import { create } from 'zustand';
import { Keypair } from '@solana/web3.js';
import { getSavedSessionKeypair, saveSessionKeypair } from '../utils/keypairUtils';

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

export const useActiveWalletStore = create<ActiveWalletState>((set, get) => ({
    activeWallet: null,
    
    setActiveWallet: (wallet) => set({ activeWallet: wallet }),

    switchActiveWallet: (params) => {
        const { keypair, network, source } = params;
        const address = params.address || (keypair ? keypair.publicKey.toBase58() : '');
        
        if (source === 'session') {
           saveSessionKeypair(keypair);
        }

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
    }
}));
