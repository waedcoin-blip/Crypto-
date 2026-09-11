// src/components/TradingSettings.tsx
import React, { useState, useEffect } from 'react';
import { useTradeMode } from '../context/TradeModeContext';
import { MasterMonitorPanel } from './MasterMonitorPanel';
import { masterMonitorHealthManager } from '../services/MasterMonitorHealthManager';
import { useWalletBridge } from '../services/walletBridge';
import { useAppStore } from '../store/appStore';
import { Shield, Key, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';

// Base58 validation
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;
const isBase58 = (s: string) => BASE58_REGEX.test(s) && s.length >= 32;

export const TradingSettings: React.FC = () => {
  const { mode, setMode } = useTradeMode();
  const { status, address, solBalance, connectFromKey, disconnect, refreshBalance } = useWalletBridge();
  const addLog = useAppStore((s) => s.addLog);

  const [privateKey, setPrivateKey] = useState('');
  const [rpcUrl, setRpcUrl] = useState('');
  const [masterMonitorRpc, setMasterMonitorRpc] = useState('');
  const [masterMonitorRpc2, setMasterMonitorRpc2] = useState('');
  const [masterMonitorWs, setMasterMonitorWs] = useState('');
  const [vaultPubkey, setVaultPubkey] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  // Clean up any insecure legacy keys from localStorage on mount
  useEffect(() => {
    try {
      localStorage.removeItem('enc_private_key');
      localStorage.removeItem('enc_jupiter_api_key');
      localStorage.removeItem('jupiter_auto_privateKey');
      localStorage.removeItem('jupiter_api_key');
    } catch {
      // Ignore errors
    }

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
  }, []);

  const handleConnectWallet = async () => {
    if (!privateKey.trim()) {
      alert('Enter a valid Base58 private key');
      return;
    }

    if (!isBase58(privateKey.trim())) {
      alert('Private key must be valid Base58 (32+ chars, no 0, O, I, l)');
      return;
    }

    if (mode === 'mainnet') {
      const confirmed = window.confirm(
        '⚠️ MAINNET WARNING:\n\n' +
        'You are connecting a live mainnet wallet. The key will reside IN-MEMORY ONLY for this browser session ' +
        'and will NEVER be written to localStorage or disk.\n\nContinue?'
      );
      if (!confirmed) return;
    }

    setLoading(true);
    try {
      const ok = await connectFromKey(privateKey.trim(), mode === 'mainnet' ? 'mainnet' : 'paper');
      if (ok) {
        setPrivateKey(''); // Wipe raw input immediately
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEndpoints = () => {
    if (rpcUrl) {
      localStorage.setItem('rpc_url', rpcUrl);
      localStorage.setItem('juipter_auto_rpcUrl', rpcUrl);
    }
    masterMonitorHealthManager.setEndpoints(masterMonitorRpc, masterMonitorRpc2, masterMonitorWs);
    if (vaultPubkey) localStorage.setItem('vault_pubkey', vaultPubkey);

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="w-full max-w-lg mx-auto space-y-5 p-4 rounded-xl border border-[#1f212e] bg-[#0c0d14] text-white">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between rounded-[10px] border border-gray-800 p-3 bg-[#11121c]">
        <span className="text-[13px] font-medium text-gray-200">
          Trading Mode
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMode('paper')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all cursor-pointer ${
              mode === 'paper'
                ? 'bg-purple-600 text-white shadow'
                : 'text-gray-400 hover:text-purple-300'
            }`}
          >
            Paper
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
          <p className="text-[11px] text-rose-400 font-medium flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Live mode uses real funds. Keys are held in session memory only (never saved to localStorage).
          </p>
        </div>
      )}

      {/* Security Architecture Notice */}
      <div className="rounded-[10px] border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-slate-300 space-y-1">
        <div className="flex items-center gap-2 font-bold text-emerald-400 text-[11px]">
          <Shield className="w-3.5 h-3.5" />
          Zero-Persistence Keystore Active
        </div>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Private keys reside in volatile browser session memory only. No private keys are saved to localStorage, indexedDB, or transmitted over network.
        </p>
      </div>

      {/* Active Wallet Status / Key Connect */}
      <div className="rounded-[10px] border border-gray-800 bg-[#11121c] p-3 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[12px] font-medium text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-[#c7f284]" />
            Session Wallet
          </label>
          <span className={`text-[10px] font-mono uppercase ${status === 'CONNECTED' ? 'text-emerald-400' : 'text-slate-500'}`}>
            {status}
          </span>
        </div>

        {status === 'CONNECTED' ? (
          <div className="space-y-2 bg-[#050509] border border-[#2d2e3d] rounded-lg p-2.5">
            <div className="text-[10px] text-[#64748b] uppercase">Active Address</div>
            <div className="text-xs font-mono text-white break-all">{address}</div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-mono text-[#c7f284]">
                {solBalance !== null ? `${solBalance.toFixed(4)} SOL` : '—'}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={refreshBalance}
                  className="px-2 py-1 bg-[#1f212e] hover:bg-[#2a2d3e] rounded text-[10px] text-slate-300 flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
                <button
                  onClick={disconnect}
                  className="px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-[10px]"
                >
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="password"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="Paste Base58 private key (in-memory only)"
              className="w-full rounded-[10px] border border-gray-800 bg-[#050509] px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#c7f284]"
              autoComplete="off"
            />
            <button
              onClick={handleConnectWallet}
              disabled={loading || !privateKey.trim()}
              className="w-full bg-[#c7f284]/10 hover:bg-[#c7f284]/20 text-[#c7f284] border border-[#c7f284]/30 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect to Session Memory'}
            </button>
          </div>
        )}
      </div>

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
      <div className="pt-2">
        <button
          onClick={handleSaveEndpoints}
          className="w-full rounded-[10px] bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5
            text-[13px] font-semibold text-black transition-all cursor-pointer"
        >
          {saved ? '✓ Endpoints Saved' : 'Save Endpoints'}
        </button>
      </div>
    </div>
  );
};
