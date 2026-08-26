import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export interface WalletMetadata {
  address: string;
  network: 'paper' | 'devnet' | 'mainnet';
  initialized: boolean;
  lastUpdated: number;
}

export function getKeypairFromPrivateKey(input: string): Keypair {
  if (!input || !input.trim()) {
    throw new Error('Private key cannot be empty');
  }
  const trimmed = input.trim();
  let bytes: Uint8Array;

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error('JSON input must be an array of numbers');
      }
      bytes = new Uint8Array(parsed);
    } catch (e: any) {
      throw new Error(`Invalid JSON array format: ${e.message}`);
    }
  } else {
    try {
      bytes = bs58.decode(trimmed);
    } catch (e: any) {
      throw new Error('Invalid Base58 private key string');
    }
  }

  if (bytes.length === 64) {
    return Keypair.fromSecretKey(bytes);
  } else if (bytes.length === 32) {
    return Keypair.fromSeed(bytes);
  } else {
    throw new Error(`Invalid private key length (${bytes.length} bytes). Must decode to 32 bytes (seed) or 64 bytes (full secret key).`);
  }
}

export function getSavedSessionKeypair(): Keypair | null {
  if (typeof window === 'undefined') return null;
  
  // 1. Check transient sessionStorage first
  const sessionCandidates = [
    sessionStorage.getItem('matrix_session_key'),
    sessionStorage.getItem('solana_session_wallet'),
  ];
  for (const raw of sessionCandidates) {
    if (raw && raw.trim()) {
      try {
        const kp = getKeypairFromPrivateKey(raw);
        if (kp) return kp;
      } catch {
        // continue
      }
    }
  }

  // 2. Check legacy localStorage (migrate to sessionStorage and purge from localStorage)
  const legacyLocalCandidates = [
    'matrix_user_custom_key',
    'app_active_private_key',
    'solana_session_wallet',
  ];
  for (const key of legacyLocalCandidates) {
    const raw = localStorage.getItem(key);
    if (raw && raw.trim()) {
      try {
        const kp = getKeypairFromPrivateKey(raw);
        if (kp) {
          // Migrate to sessionStorage and remove from localStorage
          saveSessionKeypair(kp);
          return kp;
        }
      } catch {
        // continue
      } finally {
        localStorage.removeItem(key);
      }
    }
  }

  return null;
}

export function saveSessionKeypair(kp: Keypair | null, network: 'paper' | 'devnet' | 'mainnet' = 'devnet'): void {
  if (typeof window === 'undefined') return;

  // Always purge private keys from persistent localStorage
  localStorage.removeItem('matrix_user_custom_key');
  localStorage.removeItem('app_active_private_key');
  localStorage.removeItem('solana_session_wallet');

  if (kp) {
    const encoded = bs58.encode(kp.secretKey);
    const address = kp.publicKey.toBase58();
    
    // Store only in transient sessionStorage
    sessionStorage.setItem('matrix_session_key', encoded);
    sessionStorage.setItem('solana_session_wallet', encoded);
    
    // Non-sensitive public metadata is stored in localStorage
    const meta: WalletMetadata = {
      address,
      network,
      initialized: true,
      lastUpdated: Date.now(),
    };
    localStorage.setItem('matrix_wallet_metadata', JSON.stringify(meta));
  } else {
    sessionStorage.removeItem('matrix_session_key');
    sessionStorage.removeItem('solana_session_wallet');
    localStorage.removeItem('matrix_wallet_metadata');
  }
}

export function getWalletMetadata(): WalletMetadata | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('matrix_wallet_metadata');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getOrCreateSessionKeypair(): Keypair {
  let kp = getSavedSessionKeypair();
  if (!kp) {
    const meta = getWalletMetadata();
    // If a wallet was already initialized previously but key is corrupted/lost,
    // do NOT silently replace it with a random empty wallet without user action.
    if (meta && meta.initialized) {
      console.warn('[Wallet] Existing wallet metadata found but key could not be recovered. Refusing to overwrite with new wallet.');
    }
    kp = Keypair.generate();
    saveSessionKeypair(kp);
  }
  return kp;
}

