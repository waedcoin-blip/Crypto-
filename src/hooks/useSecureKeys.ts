// src/hooks/useSecureKeys.ts
import { useState, useCallback } from 'react';

export interface SecureKeys {
  jupiterApiKey: string;
  privateKey: string;
  rpcUrl: string;
  vaultPubkey: string;
}

export function useSecureKeys() {
  const [keys, setKeys] = useState<SecureKeys>({
    jupiterApiKey: '',
    privateKey: '',
    rpcUrl: '',
    vaultPubkey: '',
  });

  const loadKeys = useCallback(async (password: string): Promise<boolean> => {
    try {
      const encApiKey = localStorage.getItem('enc_jupiter_api_key');
      const encPrivKey = localStorage.getItem('enc_private_key');
      const rpcUrl = localStorage.getItem('rpc_url') || '';
      const vaultPubkey = localStorage.getItem('vault_pubkey') || '';

      if (!encApiKey || !encPrivKey) return false;

      const { decryptData } = await import('../components/TradingSettings');
      const apiKey = await decryptData(encApiKey, password);
      const privKey = await decryptData(encPrivKey, password);

      setKeys({ jupiterApiKey: apiKey, privateKey: privKey, rpcUrl, vaultPubkey });
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearKeys = useCallback(() => {
    setKeys({ jupiterApiKey: '', privateKey: '', rpcUrl: '', vaultPubkey: '' });
  }, []);

  return { keys, loadKeys, clearKeys };
}
