// src/components/WalletSignerSync.tsx
import React, { useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { connectedWalletService } from '../services/connectedWalletService';
import { useActiveWalletStore } from '../store/activeWalletStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';

export const WalletSignerSync: React.FC = () => {
  const { publicKey, signTransaction, signAllTransactions, sendTransaction, wallet } = useWallet();
  const { activeWallet, switchActiveWallet } = useActiveWalletStore();
  const network = useTradingEnvironmentStore((s) => s.network);

  // Sync connected wallet signer to global connectedWalletService
  useEffect(() => {
    if (publicKey) {
      connectedWalletService.setSigner({
        publicKey,
        signTransaction,
        signAllTransactions,
        sendTransaction,
        walletName: wallet?.adapter.name,
      });
    } else {
      connectedWalletService.setSigner(null);
    }
  }, [publicKey, signTransaction, signAllTransactions, sendTransaction, wallet]);

  // Synchronize connected browser wallet to ActiveWalletStore
  useEffect(() => {
    if (publicKey) {
      const addressStr = publicKey.toBase58();
      if (activeWallet?.address !== addressStr || activeWallet?.source !== 'connected') {
        switchActiveWallet({
          keypair: null,
          address: addressStr,
          network,
          source: 'connected',
        });
      }
    }
  }, [publicKey, network, activeWallet, switchActiveWallet]);

  return null;
};
