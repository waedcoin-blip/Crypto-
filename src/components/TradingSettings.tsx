import { getKeypairFromPrivateKey } from "../utils/keypairUtils";
import { useActiveWalletStore } from "../store/activeWalletStore";
// src/components/TradingSettings.tsx
import React, { useState, useEffect } from 'react';
import { SecureInput } from './SecureInput';
import { useTradeMode } from '../context/TradeModeContext';
import { MasterMonitorPanel } from './MasterMonitorPanel';
import { masterMonitorHealthManager } from '../services/MasterMonitorHealthManager';

// Simple encryption using a user password + AES-GCM via Web Crypto
export async function encryptData(plaintext: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(plaintext)
  );
  const buf = new Uint8Array([...salt, ...iv, ...new Uint8Array(ciphertext)]);
  return btoa(String.fromCharCode(...buf));
}

export async function decryptData(ciphertext: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const data = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const ct = data.slice(28);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// Base58 validation
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;
const isBase58 = (s: string) => BASE58_REGEX.test(s) && s.length >= 32;

export const TradingSettings: React.FC = () => {
  const { mode, setMode } = useTradeMode();

  const [jupiterApiKey, setJupiterApiKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [rpcUrl, setRpcUrl] = useState('');
  const [masterMonitorRpc, setMasterMonitorRpc] = useState('');
  const [masterMonitorRpc2, setMasterMonitorRpc2] = useState('');
  const [masterMonitorWs, setMasterMonitorWs] = useState('');
  const [vaultPubkey, setVaultPubkey] = useState('');
  const [password, setPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load encrypted keys on mount
  useEffect(() => {
    const encApiKey = localStorage.getItem('enc_jupiter_api_key');
    const encPrivKey = localStorage.getItem('enc_private_key');
    const savedRpc = localStorage.getItem('rpc_url') || localStorage.getItem('juipter_auto_rpcUrl');
    const savedMasterRpc = localStorage.getItem('master_monitor_rpc') || '';
    const savedMasterRpc2 = localStorage.getItem('master_monitor_rpc2') || '';
    const savedMasterWs = localStorage.getItem('master_monitor_ws') || '';
    const savedVault = localStorage.getItem('vault_pubkey');

    if (savedRpc) setRpcUrl(savedRpc);
    setMasterMonitorRpc(savedMasterRpc);
    setMasterMonitorRpc2(savedMasterRpc2);
    setMasterMonitorWs(savedMasterWs);
    if (savedVault) setVaultPubkey(savedVault);

    // Keys remain encrypted until user enters password
    if (encApiKey) setJupiterApiKey('••••••••••••••••••••••••••');
    if (encPrivKey) setPrivateKey('••••••••••••••••••••••••••');
  }, []);

  const handleSave = async () => {
    if (!password) {
      alert('Enter a session password to encrypt your keys');
      return;
    }
    if (privateKey !== '••••••••••••••••••••••••••' && privateKey.length > 0 && !isBase58(privateKey)) {
      alert('Private key must be valid Base58');
      return;
    }

    setLoading(true);
    try {
      if (jupiterApiKey && jupiterApiKey !== '••••••••••••••••••••••••••') {
        localStorage.setItem('enc_jupiter_api_key', await encryptData(jupiterApiKey, password));
        localStorage.setItem('jupiter_api_key', jupiterApiKey);
      }
      if (privateKey && privateKey !== '••••••••••••••••••••••••••') {
        try {
          const kp = getKeypairFromPrivateKey(privateKey);
          useActiveWalletStore.getState().switchActiveWallet({ keypair: kp, network: 'mainnet', source: 'session' });
        } catch (e) {}

        localStorage.setItem('enc_private_key', await encryptData(privateKey, password));
      }
      if (rpcUrl) {
        localStorage.setItem('rpc_url', rpcUrl);
        localStorage.setItem('juipter_auto_rpcUrl', rpcUrl);
      }
      masterMonitorHealthManager.setEndpoints(masterMonitorRpc, masterMonitorRpc2, masterMonitorWs);
      if (vaultPubkey) localStorage.setItem('vault_pubkey', vaultPubkey);

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setLoading(false);
    }
  };

  const handleDecrypt = async () => {
    if (!password) return;
    try {
      const encApiKey = localStorage.getItem('enc_jupiter_api_key');
      const encPrivKey = localStorage.getItem('enc_private_key');
      if (encApiKey) setJupiterApiKey(await decryptData(encApiKey, password));
      if (encPrivKey) setPrivateKey(await decryptData(encPrivKey, password));
    } catch {
      alert('Wrong password');
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto space-y-5 p-4 rounded-xl border border-[#1f212e] bg-[#0c0d14] text-white">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between rounded-[10px] border border-gray-800 p-3 bg-[#11121c]">
        <span className="text-[13px] font-medium text-gray-200">
          Trading Mode
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('devnet')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all cursor-pointer ${
              mode === 'devnet'
                ? 'bg-white text-black shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Devnet
          </button>
          <button
            onClick={() => setMode('mainnet')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all cursor-pointer ${
              mode === 'mainnet'
                ? 'bg-rose-600 text-white shadow'
                : 'text-gray-400 hover:text-rose-400'
            }`}
          >
            Mainnet
          </button>
        </div>
      </div>

      {mode === 'mainnet' && (
        <div className="rounded-[10px] border border-rose-500/30 bg-rose-500/10 p-3">
          <p className="text-[11px] text-rose-400 font-medium">
            ⚠️ Live mode uses real funds. Double-check all settings before saving.
          </p>
        </div>
      )}

      {/* Session Password */}
      <SecureInput
        label="Session Password"
        value={password}
        onChange={setPassword}
        placeholder="Used to encrypt/decrypt keys locally"
        validate={(v) => v.length < 8 ? 'Min 8 characters' : null}
      />

      {/* Jupiter API Key */}
      <SecureInput
        label="Jupiter API Key"
        value={jupiterApiKey}
        onChange={setJupiterApiKey}
        placeholder="jup_xxxxxxxxxxxxxxxx"
        validate={(v) => v.length > 0 && v.length < 20 ? 'Invalid API key format' : null}
      />

      {/* Private Key */}
      <SecureInput
        label="Private Key (Base58)"
        value={privateKey}
        onChange={setPrivateKey}
        placeholder="Paste your base58-encoded private key"
        isBase58
        rows={3}
        validate={(v) => {
          if (v === '••••••••••••••••••••••••••' || v === '') return null;
          return !isBase58(v) ? 'Must be valid Base58 (no 0, O, I, l)' : null;
        }}
      />

      {/* RPC URL */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-medium text-gray-300 uppercase tracking-wider">
          Solana RPC URL
        </label>
        <input
          type="text"
          value={rpcUrl}
          onChange={(e) => setRpcUrl(e.target.value)}
          placeholder="https://mainnet.helius-rpc.com/?api-key=..."
          className="w-full rounded-[10px] border border-gray-800 bg-[#11121c]
            px-3 py-2.5 text-[13px] text-white font-mono
            placeholder:text-gray-600
            focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
      </div>

      {/* Master Monitor Section */}
      <MasterMonitorPanel
        rpcUrl={rpcUrl}
        masterMonitorRpc={masterMonitorRpc}
        setMasterMonitorRpc={setMasterMonitorRpc}
        masterMonitorRpc2={masterMonitorRpc2}
        setMasterMonitorRpc2={setMasterMonitorRpc2}
        masterMonitorWs={masterMonitorWs}
        setMasterMonitorWs={setMasterMonitorWs}
      />

      {/* Vault Pubkey */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-medium text-gray-300 uppercase tracking-wider">
          Vault Address (optional)
        </label>
        <input
          type="text"
          value={vaultPubkey}
          onChange={(e) => setVaultPubkey(e.target.value)}
          placeholder="Profit share destination address"
          className="w-full rounded-[10px] border border-gray-800 bg-[#11121c]
            px-3 py-2.5 text-[13px] text-white font-mono
            placeholder:text-gray-600
            focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={handleDecrypt}
          disabled={!password}
          className="flex-1 rounded-[10px] border border-gray-700 px-4 py-2.5
            text-[13px] font-medium text-gray-300
            hover:border-white hover:text-white
            disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
        >
          Decrypt Keys
        </button>
        <button
          onClick={handleSave}
          disabled={loading}
          className="flex-1 rounded-[10px] bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5
            text-[13px] font-semibold text-black
            disabled:opacity-50 transition-all cursor-pointer"
        >
          {loading ? 'Encrypting...' : saved ? '✓ Saved' : 'Save & Encrypt'}
        </button>
      </div>
    </div>
  );
};
