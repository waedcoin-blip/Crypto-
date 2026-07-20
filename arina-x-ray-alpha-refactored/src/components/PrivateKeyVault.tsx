/**
 * PrivateKeyVault Component
 * ─────────────────────────
 * Secure UI for storing/retrieving encrypted private keys.
 * Never displays plaintext key; only unlocks with password.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Eye, EyeOff, Lock, Unlock, AlertTriangle, CheckCircle } from 'lucide-react';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  isValidBase58PrivateKey,
  isEncryptedBundle,
  EncryptedKeyBundle
} from '../lib/keyEncryption';

interface PrivateKeyVaultProps {
  storageKey: string; // e.g., 'simreal_privateKey'
  onKeyReady?: (privateKey: string) => void;
  label?: string;
  description?: string;
}

interface VaultState {
  status: 'locked' | 'unlocked' | 'error' | 'empty';
  encryptedBundle: EncryptedKeyBundle | null;
  unlockedKey: string | null;
  errorMsg: string;
}

export const PrivateKeyVault: React.FC<PrivateKeyVaultProps> = ({
  storageKey,
  onKeyReady,
  label = 'Private Key',
  description = 'Encrypted with password. Never sent to servers.'
}) => {
  const [vaultState, setVaultState] = useState<VaultState>({
    status: 'empty',
    encryptedBundle: null,
    unlockedKey: null,
    errorMsg: ''
  });

  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [newKeyInput, setNewKeyInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [mode, setMode] = useState<'view' | 'add'>('view');

  // Load encrypted key from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
      setVaultState(prev => ({ ...prev, status: 'empty' }));
      return;
    }

    try {
      const parsed = JSON.parse(stored);
      if (isEncryptedBundle(parsed)) {
        setVaultState(prev => ({
          ...prev,
          status: 'locked',
          encryptedBundle: parsed,
          errorMsg: ''
        }));
      } else {
        // Fallback: old plaintext key (migrate it)
        setVaultState(prev => ({
          ...prev,
          status: 'locked',
          encryptedBundle: { version: '1', encrypted: parsed, salt: '', iv: '', timestamp: Date.now() },
          errorMsg: '⚠️ Old plaintext key detected. Please re-encrypt with a password.'
        }));
      }
    } catch (err) {
      setVaultState(prev => ({
        ...prev,
        status: 'error',
        errorMsg: `Failed to load key: ${err instanceof Error ? err.message : String(err)}`
      }));
    }
  }, [storageKey]);

  /**
   * Unlock the vault with password
   */
  const handleUnlock = useCallback(() => {
    if (!vaultState.encryptedBundle || !password) {
      setVaultState(prev => ({
        ...prev,
        status: 'error',
        errorMsg: 'Password required'
      }));
      return;
    }

    try {
      const decrypted = decryptPrivateKey(vaultState.encryptedBundle, password);

      if (!isValidBase58PrivateKey(decrypted)) {
        throw new Error('Decrypted key is not a valid private key');
      }

      setVaultState(prev => ({
        ...prev,
        status: 'unlocked',
        unlockedKey: decrypted,
        errorMsg: ''
      }));

      onKeyReady?.(decrypted);
      setPassword(''); // Clear password from memory after success
    } catch (err) {
      setVaultState(prev => ({
        ...prev,
        status: 'error',
        errorMsg: `Unlock failed: ${err instanceof Error ? err.message : String(err)}`
      }));
    }
  }, [vaultState.encryptedBundle, password, onKeyReady]);

  /**
   * Lock the vault (clear unlocked key from memory)
   */
  const handleLock = useCallback(() => {
    setVaultState(prev => ({
      ...prev,
      status: 'locked',
      unlockedKey: null
    }));
    setPassword('');
  }, []);

  /**
   * Store a new encrypted key
   */
  const handleSaveNewKey = useCallback(() => {
    if (!newKeyInput || !newPasswordInput) {
      setVaultState(prev => ({
        ...prev,
        errorMsg: 'Key and password required'
      }));
      return;
    }

    if (!isValidBase58PrivateKey(newKeyInput)) {
      setVaultState(prev => ({
        ...prev,
        errorMsg: 'Invalid private key format (must be base58, ~88 chars)'
      }));
      return;
    }

    try {
      const encrypted = encryptPrivateKey(newKeyInput, newPasswordInput);
      localStorage.setItem(storageKey, JSON.stringify(encrypted));

      setVaultState(prev => ({
        ...prev,
        status: 'locked',
        encryptedBundle: encrypted,
        unlockedKey: null,
        errorMsg: ''
      }));

      setNewKeyInput('');
      setNewPasswordInput('');
      setPassword('');
      setMode('view');

      // Auto-unlock with the new password
      try {
        const decrypted = decryptPrivateKey(encrypted, newPasswordInput);
        setVaultState(prev => ({
          ...prev,
          status: 'unlocked',
          unlockedKey: decrypted
        }));
        onKeyReady?.(decrypted);
      } catch (err) {
        console.warn('Auto-unlock failed after save:', err);
      }
    } catch (err) {
      setVaultState(prev => ({
        ...prev,
        status: 'error',
        errorMsg: `Save failed: ${err instanceof Error ? err.message : String(err)}`
      }));
    }
  }, [newKeyInput, newPasswordInput, storageKey, onKeyReady]);

  /**
   * Remove the stored key
   */
  const handleRemoveKey = useCallback(() => {
    if (!window.confirm('Remove stored key? You can add it again later.')) return;

    localStorage.removeItem(storageKey);
    setVaultState({
      status: 'empty',
      encryptedBundle: null,
      unlockedKey: null,
      errorMsg: ''
    });
    setPassword('');
    setMode('view');
  }, [storageKey]);

  // ─────────────────────────────────────────────────────────────
  // Render based on state
  // ─────────────────────────────────────────────────────────────

  if (vaultState.status === 'empty') {
    return (
      <div className="border border-yellow-600 bg-yellow-950 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-400" />
          <span className="text-yellow-200 font-mono text-sm">No {label} Stored</span>
        </div>

        {mode === 'view' ? (
          <button
            onClick={() => setMode('add')}
            className="w-full px-3 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm font-mono"
          >
            Add {label}
          </button>
        ) : (
          <div className="space-y-2">
            <textarea
              value={newKeyInput}
              onChange={(e) => setNewKeyInput(e.target.value)}
              placeholder="Paste your base58-encoded private key..."
              className="w-full px-3 py-2 bg-black border border-yellow-600 text-yellow-100 rounded font-mono text-xs"
              rows={3}
            />

            <input
              type={showPassword ? 'text' : 'password'}
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              placeholder="Create encryption password..."
              className="w-full px-3 py-2 bg-black border border-yellow-600 text-yellow-100 rounded font-mono text-xs"
            />

            <p className="text-yellow-300 text-xs">
              Password will encrypt your key before storage. Keep it safe!
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleSaveNewKey}
                className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-mono"
              >
                Encrypt & Save
              </button>
              <button
                onClick={() => {
                  setMode('view');
                  setNewKeyInput('');
                  setNewPasswordInput('');
                }}
                className="flex-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded text-sm font-mono"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {vaultState.errorMsg && (
          <p className="text-red-400 text-xs">{vaultState.errorMsg}</p>
        )}
      </div>
    );
  }

  if (vaultState.status === 'locked') {
    return (
      <div className="border border-blue-600 bg-blue-950 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-blue-400" />
          <span className="text-blue-200 font-mono text-sm">{label} (Locked)</span>
        </div>

        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleUnlock()}
              placeholder="Enter password to unlock..."
              className="flex-1 px-3 py-2 bg-black border border-blue-600 text-blue-100 rounded font-mono text-xs"
            />
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleUnlock}
              className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-mono"
            >
              Unlock
            </button>
            <button
              onClick={() => setMode('add')}
              className="flex-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded text-sm font-mono text-xs"
            >
              Replace
            </button>
            <button
              onClick={handleRemoveKey}
              className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-mono"
            >
              ✕
            </button>
          </div>
        </div>

        {vaultState.errorMsg && (
          <p className="text-red-400 text-xs">{vaultState.errorMsg}</p>
        )}
      </div>
    );
  }

  if (vaultState.status === 'unlocked') {
    return (
      <div className="border border-green-600 bg-green-950 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-400" />
          <span className="text-green-200 font-mono text-sm">{label} (Unlocked)</span>
        </div>

        <div className="bg-black px-3 py-2 rounded border border-green-600 text-green-400 font-mono text-xs break-all">
          {vaultState.unlockedKey?.slice(0, 20)}...
          {vaultState.unlockedKey?.slice(-10)}
        </div>

        <p className="text-green-300 text-xs">
          Key is unlocked in memory. Lock it when finished.
        </p>

        <div className="flex gap-2">
          <button
            onClick={handleLock}
            className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-mono"
          >
            Lock
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(vaultState.unlockedKey || '');
              alert('Key copied to clipboard');
            }}
            className="flex-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded text-sm font-mono"
          >
            Copy
          </button>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="border border-red-600 bg-red-950 rounded-lg p-4 space-y-2">
      <p className="text-red-400 font-mono text-sm">Error</p>
      <p className="text-red-300 text-xs">{vaultState.errorMsg}</p>
      <button
        onClick={() => {
          localStorage.removeItem(storageKey);
          setVaultState({ status: 'empty', encryptedBundle: null, unlockedKey: null, errorMsg: '' });
        }}
        className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-mono"
      >
        Clear & Reset
      </button>
    </div>
  );
};

export default PrivateKeyVault;
