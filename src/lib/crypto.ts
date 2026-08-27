import { Buffer } from 'buffer';

const ALGO = 'AES-GCM';
const IV_LENGTH = 12;
const SALT = new TextEncoder().encode('solana_bot_pbkdf2_salt_v1');

async function deriveKey(uid: string, customPassword?: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const secretMaterial = (uid || 'default_app_offline_salt') + (customPassword || '');
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretMaterial),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: SALT,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: ALGO, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a Solana base58 private key or sensitive secret using AES-GCM (PBKDF2 100k rounds).
 */
export async function encryptPrivateKey(base58Key: string, uid: string, sessionPassword?: string): Promise<string> {
  if (!base58Key) return '';
  try {
    const key = await deriveKey(uid, sessionPassword);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const enc = new TextEncoder();
    const cipherBuf = await crypto.subtle.encrypt(
      { name: ALGO, iv },
      key,
      enc.encode(base58Key)
    );
    const combined = new Uint8Array(iv.length + new Uint8Array(cipherBuf).length);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuf), iv.length);
    return Buffer.from(combined).toString('base64');
  } catch (err) {
    console.error('Encryption failed:', err);
    throw new Error('SECURITY_ERROR: Failed to encrypt private key. Refusing to persist unencrypted key.');
  }
}

/**
 * Decrypts a previously encrypted base58 private key.
 * Detects legacy plaintext keys and automatically re-encrypts them via onMigrate callback.
 */
export async function decryptPrivateKey(
  encryptedBase64: string,
  uid: string,
  sessionPassword?: string,
  onMigrate?: (newEncrypted: string) => void
): Promise<string> {
  if (!encryptedBase64) return '';

  // Check if it is a legacy plaintext Base58 key
  if (encryptedBase64.length >= 80 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(encryptedBase64)) {
    if (onMigrate) {
      encryptPrivateKey(encryptedBase64, uid, sessionPassword).then((reEncrypted) => {
        onMigrate(reEncrypted);
      }).catch(() => {});
    }
    return encryptedBase64;
  }

  try {
    const key = await deriveKey(uid, sessionPassword);
    const combined = new Uint8Array(Buffer.from(encryptedBase64, 'base64'));
    if (combined.length <= IV_LENGTH) return encryptedBase64;
    const iv = combined.slice(0, IV_LENGTH);
    const cipherText = combined.slice(IV_LENGTH);
    const plainBuf = await crypto.subtle.decrypt(
      { name: ALGO, iv },
      key,
      cipherText
    );
    return new TextDecoder().decode(plainBuf);
  } catch (err) {
    // Legacy migration fallback for SHA-256 single-pass
    try {
      const enc = new TextEncoder();
      const secretMaterial = (uid || 'default_app_offline_salt') + (sessionPassword || '');
      const raw = await crypto.subtle.digest('SHA-256', enc.encode(secretMaterial));
      const legacyKey = await crypto.subtle.importKey('raw', raw, { name: ALGO }, false, ['decrypt']);
      const combined = new Uint8Array(Buffer.from(encryptedBase64, 'base64'));
      const iv = combined.slice(0, IV_LENGTH);
      const cipherText = combined.slice(IV_LENGTH);
      const plainBuf = await crypto.subtle.decrypt({ name: ALGO, iv }, legacyKey, cipherText);
      const decryptedPlaintext = new TextDecoder().decode(plainBuf);
      
      // Auto-migrate legacy SHA-256 cipher to PBKDF2 100k rounds
      if (onMigrate) {
        encryptPrivateKey(decryptedPlaintext, uid, sessionPassword).then((reEncrypted) => {
          onMigrate(reEncrypted);
        }).catch(() => {});
      }
      return decryptedPlaintext;
    } catch {
      return encryptedBase64;
    }
  }
}
