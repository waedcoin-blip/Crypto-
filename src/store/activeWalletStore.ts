// src/store/activeWalletStore.ts
import { create } from 'zustand';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TradingNetwork } from '../config/network';
import { getSavedSessionKeypair } from '../utils/keypairUtils';

export type ActiveWalletSource = 'session' | 'connected' | null;

export interface ActiveWalletState {
  network: TradingNetwork;
  address: string | null;
  publicKey: PublicKey | null;
  keypair: Keypair | null;
  source: ActiveWalletSource;
  version: number;

  setWallet: (params: {
    network?: TradingNetwork;
    address?: string | null;
    publicKey?: PublicKey | null;
    keypair?: Keypair | null;
    source: ActiveWalletSource;
  }) => void;
  setNetwork: (network: TradingNetwork) => void;
  clearWallet: () => void;
}

const initialSaved = getSavedSessionKeypair();
const initialNetwork = (localStorage.getItem('app_trading_network') as TradingNetwork) || 'devnet';

export const useActiveWalletStore = create<ActiveWalletState>((set) => ({
  network: initialNetwork,
  address: initialSaved ? initialSaved.publicKey.toBase58() : null,
  publicKey: initialSaved ? initialSaved.publicKey : null,
  keypair: initialSaved,
  source: initialSaved ? 'session' : null,
  version: 1,

  setWallet: (params) =>
    set((state) => {
      const network = params.network || state.network;
      let address = params.address || null;
      let publicKey = params.publicKey || null;
      let keypair = params.keypair !== undefined ? params.keypair : null;

      if (keypair) {
        publicKey = keypair.publicKey;
        address = keypair.publicKey.toBase58();
      } else if (publicKey && !address) {
        address = publicKey.toBase58();
      } else if (address && !publicKey) {
        try {
          publicKey = new PublicKey(address);
        } catch {
          // Ignore parse errors
        }
      }

      return {
        network,
        address,
        publicKey,
        keypair,
        source: params.source,
        version: state.version + 1,
      };
    }),

  setNetwork: (network) =>
    set((state) => ({
      network,
      version: state.version + 1,
    })),

  clearWallet: () =>
    set((state) => ({
      address: null,
      publicKey: null,
      keypair: null,
      source: null,
      version: state.version + 1,
    })),
}));
