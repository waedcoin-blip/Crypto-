import { Buffer } from 'buffer';

const ALGO = 'AES-GCM';
const IV_LENGTH = 12;

async function deriveKey(uid: string, customPassword?: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const secretMaterial = (uid || 'default_app_offline_salt') + (customPassword || '');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secretMaterial));
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: ALGO },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a Solana base58 private key using AES-GCM.
 * @param base58Key The raw private key string
 * @param uid The user's UID to derive the AES key
 * @param sessionPassword Optional user password
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
 * Supports backward-compatibility for plaintext keys.
 * @param encryptedBase64 The base64 encrypted string (or plaintext legacy key)
 * @param uid The user's UID to derive the AES key
 * @param sessionPassword Optional user password
 */
export async function decryptPrivateKey(encryptedBase64: string, uid: string, sessionPassword?: string): Promise<string> {
  if (!encryptedBase64) return '';
  // Simple check: if it is a valid Solana Base58 private key format (typically ~88 chars of base58 characters),
  // return as-is for backward compatibility.
  if (encryptedBase64.length >= 80 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(encryptedBase64)) {
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
    // Try fallback without custom password if custom password failed (migration compatibility)
    if (sessionPassword) {
      try {
        const fallbackKey = await deriveKey(uid);
        const combined = new Uint8Array(Buffer.from(encryptedBase64, 'base64'));
        const iv = combined.slice(0, IV_LENGTH);
        const cipherText = combined.slice(IV_LENGTH);
        const plainBuf = await crypto.subtle.decrypt({ name: ALGO, iv }, fallbackKey, cipherText);
        return new TextDecoder().decode(plainBuf);
      } catch {
        // Fallthrough
      }
    }
    return encryptedBase64;
  }
}
