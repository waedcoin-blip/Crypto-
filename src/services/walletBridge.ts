// src/services/walletBridge.ts
import { create } from 'zustand';
import { Connection, PublicKey, Keypair, VersionedTransaction, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { tradingApi, healthApi } from './ApiClient';
import { useAppStore } from '../store/appStore';

// ==========================================
// IN-MEMORY EPHEMERAL KEYSTORE
// The private key is NEVER persisted. It lives only for the browser session.
// On mainnet, prefer server-side signing (WalletManager) and keep the browser read-only.
// ==========================================

let sessionKeypair: Keypair | null = null;

// ==========================================
// WALLET STORE
// ==========================================

interface WalletState {
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
  address: string;
  network: 'paper' | 'devnet' | 'mainnet';
  solBalance: number | null;
  isLocked: boolean;
  lastError: string | null;

  connectFromKey: (base58Key: string, network: 'paper' | 'devnet' | 'mainnet') => Promise<boolean>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  getKeypair: () => Keypair | null;
  signAndSend: (serializedTx: string | Uint8Array, rpcUrl: string) => Promise<string | null>;
}

export const useWalletBridge = create<WalletState>((set, get) => ({
  status: 'DISCONNECTED',
  address: '',
  network: 'paper',
  solBalance: null,
  isLocked: false,
  lastError: null,

  // ---- Connect from a base58 private key (held in memory only) ----
  connectFromKey: async (base58Key, network) => {
    const addLog = useAppStore.getState().addLog;
    set({ status: 'CONNECTING', lastError: null });

    try {
      // Validate base58 format
      if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(base58Key) || base58Key.length < 32) {
        throw new Error('Invalid private key format (must be base58)');
      }

      const secret = bs58.decode(base58Key);
      const keypair = Keypair.fromSecretKey(secret);
      sessionKeypair = keypair; // In-memory only

      set({
        status: 'CONNECTED',
        address: keypair.publicKey.toBase58(),
        network,
      });

      addLog(`🔐 [WALLET] Connected ${keypair.publicKey.toBase58().slice(0, 8)}... on ${network}`, 'success');
      await get().refreshBalance();
      return true;
    } catch (err: any) {
      const msg = err?.message || String(err);
      set({ status: 'ERROR', lastError: msg });
      addLog(`❌ [WALLET] Connection failed: ${msg}`, 'error');
      return false;
    }
  },

  // ---- Disconnect (wipes in-memory key) ----
  disconnect: () => {
    sessionKeypair = null;
    set({
      status: 'DISCONNECTED',
      address: '',
      solBalance: null,
      lastError: null,
    });
    useAppStore.getState().addLog('🔓 [WALLET] Disconnected and key wiped from memory', 'info');
  },

  // ---- Refresh SOL balance from RPC ----
  refreshBalance: async () => {
    const { address, network } = get();
    if (!address) return;

    try {
      // Paper mode: balance is simulated by backend
      if (network === 'paper') {
        const res = await tradingApi.getEngineStatus();
        set({ solBalance: res?.solBalance ?? 10 });
        return;
      }

      // Devnet/Mainnet: query RPC
      const rpcUrl = network === 'devnet'
        ? 'https://api.devnet.solana.com'
        : 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(rpcUrl, 'confirmed');
      const balance = await connection.getBalance(new PublicKey(address), 'confirmed');
      set({ solBalance: balance / 1e9 });
    } catch (err: any) {
      useAppStore.getState().addLog(`⚠️ [WALLET] Balance refresh failed: ${err?.message}`, 'warn');
    }
  },

  // ---- Get in-memory keypair (never exposed externally) ----
  getKeypair: () => sessionKeypair,

  // ---- Sign a backend-returned transaction and broadcast ----
  // IMPORTANT: This is the ONLY signing path. The browser never constructs trades.
  signAndSend: async (serializedTx, rpcUrl) => {
    const keypair = sessionKeypair;
    if (!keypair) {
      useAppStore.getState().addLog('❌ [WALLET] No wallet connected', 'error');
      return null;
    }

    try {
      const txBuffer = typeof serializedTx === 'string'
        ? Buffer.from(serializedTx, 'base64')
        : Buffer.from(serializedTx);

      const connection = new Connection(rpcUrl, 'confirmed');

      let signature: string;
      try {
        // Try VersionedTransaction (Jupiter v6+)
        const vtx = VersionedTransaction.deserialize(txBuffer);
        vtx.sign([keypair]);
        signature = await connection.sendRawTransaction(Buffer.from(vtx.serialize()), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
      } catch {
        // Fallback to legacy Transaction
        const tx = Transaction.from(txBuffer);
        tx.sign(keypair);
        signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
      }

      useAppStore.getState().addLog(`📡 [WALLET] Broadcast: ${signature.slice(0, 16)}...`, 'info');
      await get().refreshBalance();
      return signature;
    } catch (err: any) {
      useAppStore.getState().addLog(`❌ [WALLET] Sign/send failed: ${err?.message}`, 'error');
      return null;
    }
  },
}));

// ==========================================
// NON-REACTIVE HELPERS (for use outside React)
// ==========================================

export function getActiveWalletAddress(): string {
  return useWalletBridge.getState().address;
}

export function isWalletConnected(): boolean {
  return useWalletBridge.getState().status === 'CONNECTED';
}

export function requireWalletOrThrow(): Keypair {
  const kp = useWalletBridge.getState().getKeypair();
  if (!kp) throw new Error('WALLET_NOT_CONNECTED');
  return kp;
}
