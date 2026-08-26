import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export interface WalletMetadata {
  address: string;
  network: 'devnet' | 'mainnet';
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
  const candidates = [
    localStorage.getItem('matrix_user_custom_key'),
    sessionStorage.getItem('matrix_session_key'),
    localStorage.getItem('app_active_private_key'),
    localStorage.getItem('solana_session_wallet'),
    sessionStorage.getItem('solana_session_wallet'),
  ];
  for (const raw of candidates) {
    if (raw && raw.trim()) {
      try {
        const kp = getKeypairFromPrivateKey(raw);
        if (kp) {
          // Normalize into all persistent storage slots so they stay fully aligned
          saveSessionKeypair(kp);
          return kp;
        }
      } catch {
        // continue checking next candidate
      }
    }
  }
  return null;
}

export function saveSessionKeypair(kp: Keypair | null, network: 'devnet' | 'mainnet' = 'devnet'): void {
  if (typeof window === 'undefined') return;
  if (kp) {
    const encoded = bs58.encode(kp.secretKey);
    const address = kp.publicKey.toBase58();
    localStorage.setItem('matrix_user_custom_key', encoded);
    sessionStorage.setItem('matrix_session_key', encoded);
    localStorage.setItem('app_active_private_key', encoded);
    localStorage.setItem('solana_session_wallet', encoded);
    sessionStorage.setItem('solana_session_wallet', encoded);
    
    // Explicit metadata persistence
    const meta: WalletMetadata = {
      address,
      network,
      initialized: true,
      lastUpdated: Date.now(),
    };
    localStorage.setItem('matrix_wallet_metadata', JSON.stringify(meta));
  } else {
    localStorage.removeItem('matrix_user_custom_key');
    sessionStorage.removeItem('matrix_session_key');
    localStorage.removeItem('app_active_private_key');
    localStorage.removeItem('solana_session_wallet');
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

