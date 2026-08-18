import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

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
    localStorage.getItem('juipter_auto_privateKey'),
  ];
  for (const raw of candidates) {
    if (raw && raw.trim()) {
      try {
        return getKeypairFromPrivateKey(raw);
      } catch {
        // continue checking next key
      }
    }
  }
  return null;
}

export function saveSessionKeypair(kp: Keypair | null): void {
  if (typeof window === 'undefined') return;
  if (kp) {
    const encoded = bs58.encode(kp.secretKey);
    localStorage.setItem('matrix_user_custom_key', encoded);
    sessionStorage.setItem('matrix_session_key', encoded);
    localStorage.setItem('app_active_private_key', encoded);
    localStorage.setItem('juipter_auto_privateKey', encoded);
  } else {
    localStorage.removeItem('matrix_user_custom_key');
    sessionStorage.removeItem('matrix_session_key');
    localStorage.removeItem('app_active_private_key');
    localStorage.removeItem('juipter_auto_privateKey');
  }
}
