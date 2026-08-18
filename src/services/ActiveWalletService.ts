// src/services/ActiveWalletService.ts
import { Keypair, PublicKey } from '@solana/web3.js';
import { TradingNetwork, getNetworkConfig } from '../config/network';
import { useActiveWalletStore, ActiveWalletSource } from '../store/activeWalletStore';
import { useAppStore } from '../store/appStore';
import { useBalanceStore } from '../store/balanceStore';
import { saveSessionKeypair, getKeypairFromPrivateKey } from '../utils/keypairUtils';
import { walletBalanceService } from './WalletBalanceService';
import { NetworkGuard } from './NetworkGuard';

export interface WalletListener {
  onWalletChange: (keypair: Keypair | null, address: string | null, network: TradingNetwork) => void | Promise<void>;
}

class ActiveWalletServiceRegistry {
  private listeners = new Set<WalletListener>();
  private activeTradeManager: any = null;

  registerTradeManager(tradeManager: any) {
    this.activeTradeManager = tradeManager;
    const current = useActiveWalletStore.getState();
    if (this.activeTradeManager?.setWallet) {
      this.activeTradeManager.setWallet(current.keypair, current.network);
    }
  }

  registerListener(listener: WalletListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async activateSessionKey(
    rawPrivateKey: string,
    network: TradingNetwork = 'devnet'
  ): Promise<{ success: boolean; address?: string; error?: string }> {
    try {
      const keypair = getKeypairFromPrivateKey(rawPrivateKey);
      const address = keypair.publicKey.toBase58();

      // 1. Network & RPC validation
      const netConfig = getNetworkConfig(network);
      NetworkGuard.assertNetwork(network, netConfig.rpcUrl);

      // 2. Persist session keypair
      saveSessionKeypair(keypair);

      // 3. Atomically update active wallet store
      useActiveWalletStore.getState().setWallet({
        network,
        address,
        publicKey: keypair.publicKey,
        keypair,
        source: 'session',
      });

      // 4. Update legacy / shared stores
      useAppStore.getState().setSessionWallet(keypair);
      useBalanceStore.getState().setWalletAddress(address);

      // 5. Update TradeManager and execution engines
      if (this.activeTradeManager?.setWallet) {
        this.activeTradeManager.setWallet(keypair, network);
      }

      // 6. Notify registered listeners
      for (const listener of this.listeners) {
        try {
          await listener.onWalletChange(keypair, address, network);
        } catch (e) {
          console.warn('Error in wallet listener:', e);
        }
      }

      // 7. Refresh on-chain balance with generation guard
      walletBalanceService.updateNetwork(network);
      await walletBalanceService.refresh(address);

      return { success: true, address };
    } catch (err: any) {
      console.error('Failed to activate session wallet:', err);
      return { success: false, error: err.message || 'Invalid private key' };
    }
  }

  async activateConnectedWallet(publicKey: PublicKey, network: TradingNetwork = 'mainnet'): Promise<void> {
    const address = publicKey.toBase58();

    useActiveWalletStore.getState().setWallet({
      network,
      address,
      publicKey,
      keypair: null,
      source: 'connected',
    });

    useBalanceStore.getState().setWalletAddress(address);

    if (this.activeTradeManager?.setWallet) {
      this.activeTradeManager.setWallet(null, network);
    }

    for (const listener of this.listeners) {
      try {
        await listener.onWalletChange(null, address, network);
      } catch (e) {
        console.warn('Error in wallet listener:', e);
      }
    }

    walletBalanceService.updateNetwork(network);
    await walletBalanceService.refresh(address);
  }

  async clearActiveWallet(): Promise<void> {
    saveSessionKeypair(null);
    useActiveWalletStore.getState().clearWallet();
    useAppStore.getState().setSessionWallet(null);
    useBalanceStore.getState().reset();

    if (this.activeTradeManager?.setWallet) {
      this.activeTradeManager.setWallet(null);
    }

    for (const listener of this.listeners) {
      try {
        await listener.onWalletChange(null, null, useActiveWalletStore.getState().network);
      } catch (e) {
        console.warn('Error in wallet listener:', e);
      }
    }
  }
}

export const activeWalletService = new ActiveWalletServiceRegistry();
