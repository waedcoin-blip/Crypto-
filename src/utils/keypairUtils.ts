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
