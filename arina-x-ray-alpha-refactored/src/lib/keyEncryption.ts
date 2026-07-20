/**
 * Secure Key Management
 * ─────────────────────
 * AES-256 encryption for private keys before Firestore persistence.
 * Uses PBKDF2 key derivation from user password.
 *
 * Usage:
 *   const encrypted = encryptPrivateKey(privateKey, userPassword);
 *   // Store encrypted in Firestore
 *   const decrypted = decryptPrivateKey(encrypted, userPassword);
 */

import CryptoJS from 'crypto-js';

const KEY_DERIVATION_ROUNDS = 10000; // PBKDF2 iterations
const ALGORITHM = 'AES'; // CryptoJS AES-256 by default
const ENCRYPTION_VERSION = '1'; // For future compatibility

export interface EncryptedKeyBundle {
  version: string;
  encrypted: string;
  salt: string;
  iv: string;
  timestamp: number;
}

/**
 * Derive encryption key from password using PBKDF2
 */
function deriveKeyFromPassword(password: string, salt: string): string {
  return CryptoJS.PBKDF2(password, salt, {
    keySize: 256 / 32, // 256 bits = 8 words (32-bit each)
    iterations: KEY_DERIVATION_ROUNDS,
    hasher: CryptoJS.algo.SHA256
  }).toString();
}

/**
 * Generate random salt for key derivation
 */
function generateSalt(): string {
  return CryptoJS.lib.WordArray.random(128 / 8).toString();
}

/**
 * Encrypt a private key with password-based AES-256
 *
 * @param privateKey - The base58-encoded private key
 * @param password - User's password for encryption
 * @returns Encrypted bundle with all necessary data to decrypt later
 */
export function encryptPrivateKey(privateKey: string, password: string): EncryptedKeyBundle {
  if (!privateKey || !password) {
    throw new Error('Private key and password required for encryption');
  }

  if (privateKey.length < 80) {
    throw new Error('Invalid private key format (too short)');
  }

  // Generate random salt for this encryption
  const salt = generateSalt();

  // Derive encryption key from password + salt
  const key = deriveKeyFromPassword(password, salt);

  // Generate random IV (initialization vector)
  const iv = CryptoJS.lib.WordArray.random(128 / 8).toString();

  // Encrypt
  let encrypted: string;
  try {
    const encrypted_obj = CryptoJS.AES.encrypt(privateKey, key, {
      iv: CryptoJS.enc.Hex.parse(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    encrypted = encrypted_obj.toString();
  } catch (err) {
    throw new Error(`Encryption failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    version: ENCRYPTION_VERSION,
    encrypted,
    salt,
    iv,
    timestamp: Date.now()
  };
}

/**
 * Decrypt a private key with password
 *
 * @param bundle - The encrypted bundle (returned from encryptPrivateKey)
 * @param password - User's password
 * @returns Decrypted base58 private key
 */
export function decryptPrivateKey(bundle: EncryptedKeyBundle | string, password: string): string {
  // Handle backwards compatibility: if string is passed, it's the old plaintext key
  if (typeof bundle === 'string') {
    if (bundle.length > 80) {
      // Assume it's an old plaintext key
      console.warn('[KeyMgmt] ⚠️ Detected plaintext key in storage. Recommend re-encrypting.');
      return bundle;
    }
    throw new Error('Invalid encrypted bundle format');
  }

  if (!bundle.encrypted || !bundle.salt || !bundle.iv) {
    throw new Error('Invalid encrypted bundle: missing required fields');
  }

  if (!password) {
    throw new Error('Password required for decryption');
  }

  // Derive the same key using stored salt
  const key = deriveKeyFromPassword(password, bundle.salt);

  // Decrypt
  let decrypted: string;
  try {
    const decrypted_obj = CryptoJS.AES.decrypt(bundle.encrypted, key, {
      iv: CryptoJS.enc.Hex.parse(bundle.iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    decrypted = decrypted_obj.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    throw new Error(`Decryption failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!decrypted || decrypted.length < 80) {
    throw new Error('Decryption resulted in invalid key. Password may be incorrect.');
  }

  return decrypted;
}

/**
 * Check if a value is an encrypted bundle (vs plaintext key)
 */
export function isEncryptedBundle(value: any): value is EncryptedKeyBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.version === ENCRYPTION_VERSION &&
    typeof value.encrypted === 'string' &&
    typeof value.salt === 'string' &&
    typeof value.iv === 'string' &&
    typeof value.timestamp === 'number'
  );
}

/**
 * Verify that a plaintext key is valid base58
 */
export function isValidBase58PrivateKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.length < 80 || key.length > 90) return false;

  // Check if it's valid base58 (contains only valid base58 chars)
  const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return key.split('').every(char => base58Chars.includes(char));
}

/**
 * Hash a password for verification (not cryptographic security, just for UI checks)
 */
export function hashPasswordForVerification(password: string): string {
  return CryptoJS.SHA256(password).toString().slice(0, 16);
}
