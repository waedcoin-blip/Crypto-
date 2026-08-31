import { Buffer } from 'buffer';

const ALGO = 'AES-GCM';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const ITERATIONS = 600000; // Increased to 600k rounds for stronger PBKDF2 security

// We only use the uid fallback if someone doesn't provide a session password,
// but relying purely on UID is weak. In reality, the user should provide a password.
async function deriveKey(secretMaterial: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
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
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: ALGO, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a Solana base58 private key or sensitive secret using AES-GCM (PBKDF2 600k rounds).
 * Generates a random salt per encryption record.
 * 
 * Data format: Base64( version(1 byte) | salt(16 bytes) | iv(12 bytes) | ciphertext )
 */
export async function encryptPrivateKey(base58Key: string, uid: string, sessionPassword?: string): Promise<string> {
  if (!base58Key) return '';
  try {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const secretMaterial = (sessionPassword || '') + (uid || 'default_offline_uid');
    
    const key = await deriveKey(secretMaterial, salt);
    const enc = new TextEncoder();
    const cipherBuf = await crypto.subtle.encrypt(
      { name: ALGO, iv },
      key,
      enc.encode(base58Key)
    );
    
    // Format: [version: 1 byte (2)] + [salt: 16 bytes] + [iv: 12 bytes] + [ciphertext]
    const version = new Uint8Array([2]);
    const ciphertextArr = new Uint8Array(cipherBuf);
    
    const combined = new Uint8Array(version.length + salt.length + iv.length + ciphertextArr.length);
    let offset = 0;
    
    combined.set(version, offset); offset += version.length;
    combined.set(salt, offset); offset += salt.length;
    combined.set(iv, offset); offset += iv.length;
    combined.set(ciphertextArr, offset);
    
    return Buffer.from(combined).toString('base64');
  } catch (err) {
    console.error('Encryption failed:', err);
    throw new Error('SECURITY_ERROR: Failed to encrypt private key. Refusing to persist unencrypted key.');
  }
}

/**
 * Decrypts a previously encrypted base58 private key.
 * Detects legacy plaintext keys and legacy V1 encrypted keys, automatically re-encrypting them to V2 via onMigrate callback.
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

  const combined = new Uint8Array(Buffer.from(encryptedBase64, 'base64'));
  
  if (combined.length === 0) return encryptedBase64;
  
  const version = combined[0];

  try {
    if (version === 2) {
      // V2 Format
      const EXPECTED_MIN_LENGTH = 1 + SALT_LENGTH + IV_LENGTH;
      if (combined.length <= EXPECTED_MIN_LENGTH) return encryptedBase64;
      
      let offset = 1;
      const salt = combined.slice(offset, offset + SALT_LENGTH);
      offset += SALT_LENGTH;
      
      const iv = combined.slice(offset, offset + IV_LENGTH);
      offset += IV_LENGTH;
      
      const cipherText = combined.slice(offset);
      
      const secretMaterial = (sessionPassword || '') + (uid || 'default_offline_uid');
      const key = await deriveKey(secretMaterial, salt);
      
      const plainBuf = await crypto.subtle.decrypt(
        { name: ALGO, iv },
        key,
        cipherText
      );
      return new TextDecoder().decode(plainBuf);
    } else {
      // Legacy V1 (no version byte, assumed format: [iv: 12 bytes] + [ciphertext])
      // V1 used a hardcoded salt
      if (combined.length <= IV_LENGTH) return encryptedBase64;
      
      const legacySalt = new TextEncoder().encode('solana_bot_pbkdf2_salt_v1');
      const secretMaterial = (uid || 'default_app_offline_salt') + (sessionPassword || '');
      
      const enc = new TextEncoder();
      const baseKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(secretMaterial),
        'PBKDF2',
        false,
        ['deriveKey']
      );
      const legacyKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: legacySalt, iterations: 100000, hash: 'SHA-256' },
        baseKey,
        { name: ALGO, length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      
      const iv = combined.slice(0, IV_LENGTH);
      const cipherText = combined.slice(IV_LENGTH);
      
      const plainBuf = await crypto.subtle.decrypt(
        { name: ALGO, iv },
        legacyKey,
        cipherText
      );
      const decryptedPlaintext = new TextDecoder().decode(plainBuf);
      
      // Auto-migrate to V2
      if (onMigrate) {
        encryptPrivateKey(decryptedPlaintext, uid, sessionPassword).then((reEncrypted) => {
          onMigrate(reEncrypted);
        }).catch(() => {});
      }
      return decryptedPlaintext;
    }
  } catch (err) {
    // Legacy migration fallback for SHA-256 single-pass (V0)
    try {
      const enc = new TextEncoder();
      const secretMaterial = (uid || 'default_app_offline_salt') + (sessionPassword || '');
      const raw = await crypto.subtle.digest('SHA-256', enc.encode(secretMaterial));
      const legacyKey = await crypto.subtle.importKey('raw', raw, { name: ALGO }, false, ['decrypt']);
      const iv = combined.slice(0, IV_LENGTH);
      const cipherText = combined.slice(IV_LENGTH);
      const plainBuf = await crypto.subtle.decrypt({ name: ALGO, iv }, legacyKey, cipherText);
      const decryptedPlaintext = new TextDecoder().decode(plainBuf);
      
      // Auto-migrate to V2
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
