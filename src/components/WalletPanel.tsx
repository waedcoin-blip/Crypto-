// src/components/WalletPanel.tsx
import React, { useState, useEffect } from 'react';
import { Wallet, RefreshCw, Power, Shield, AlertTriangle } from 'lucide-react';
import { useWalletBridge } from '../services/walletBridge';
import { useAppStore } from '../store/appStore';

export function WalletPanel() {
  const { status, address, network, solBalance, connectFromKey, disconnect, refreshBalance } = useWalletBridge();
  const [keyInput, setKeyInput] = useState('');
  const [selectedNetwork, setSelectedNetwork] = useState<'paper' | 'devnet' | 'mainnet'>('paper');
  const tradeMode = useAppStore((s) => s.tradeMode);
  const addLog = useAppStore((s) => s.addLog);

  const isConnected = status === 'CONNECTED';
  const isConnecting = status === 'CONNECTING';

  // Auto-refresh balance every 30s when connected
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(refreshBalance, 30000);
    return () => clearInterval(interval);
  }, [isConnected, refreshBalance]);

  const handleConnect = async () => {
    if (!keyInput.trim()) {
      addLog('⚠️ [WALLET] Enter a private key to connect', 'warn');
      return;
    }

    // SAFETY: Warn about mainnet
    if (selectedNetwork === 'mainnet') {
      const confirmed = window.confirm(
        '⚠️ MAINNET WARNING:\n\n' +
        'You are connecting a real wallet. The private key will be held in browser memory ONLY (not saved), ' +
        'but for maximum safety, prefer the server-side wallet (WalletManager) for mainnet trading.\n\n' +
        'Continue?'
      );
      if (!confirmed) return;
    }

    const ok = await connectFromKey(keyInput.trim(), selectedNetwork);
    if (ok) {
      setKeyInput(''); // Clear input immediately — never retain the key
    }
  };

  const statusColor = {
    DISCONNECTED: 'text-slate-500',
    CONNECTING: 'text-amber-400',
    CONNECTED: 'text-emerald-400',
    ERROR: 'text-rose-400',
  }[status];

  return (
    <div className="bg-[#0f111a] border border-[#2d2e3d] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-[#c7f284]" />
          <h3 className="text-sm font-bold text-white">Wallet</h3>
        </div>
        <span className={`text-[10px] font-mono uppercase ${statusColor}`}>{status}</span>
      </div>

      {isConnected ? (
        // ---- CONNECTED VIEW ----
        <div className="space-y-3">
          <div className="bg-[#050509] border border-[#2d2e3d] rounded-lg p-3">
            <div className="text-[10px] text-[#64748b] uppercase mb-1">Address ({network})</div>
            <div className="text-xs font-mono text-white break-all">
              {address.slice(0, 12)}...{address.slice(-8)}
            </div>
            <div className="text-lg font-mono text-[#c7f284] mt-2">
              {solBalance !== null ? `${solBalance.toFixed(4)} SOL` : '—'}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={refreshBalance}
              className="flex-1 flex items-center justify-center gap-2 bg-[#1b1c26] hover:bg-[#232638] text-slate-300 text-xs py-2 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
            <button
              onClick={disconnect}
              className="flex-1 flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs py-2 rounded-lg transition-colors"
            >
              <Power className="w-3 h-3" /> Disconnect
            </button>
          </div>

          <div className="flex items-start gap-2 text-[10px] text-[#64748b] bg-[#181a26] rounded-lg p-2">
            <Shield className="w-3 h-3 mt-0.5 flex-shrink-0 text-emerald-400" />
            <span>Key held in memory only. Never persisted. Cleared on disconnect/refresh.</span>
          </div>
        </div>
      ) : (
        // ---- DISCONNECTED VIEW ----
        <div className="space-y-3">
          <select
            value={selectedNetwork}
            onChange={(e) => setSelectedNetwork(e.target.value as any)}
            className="w-full bg-[#050509] border border-[#2d2e3d] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#c7f284]"
          >
            <option value="paper">Paper Trading (Simulated)</option>
            <option value="devnet">Devnet (Test)</option>
            <option value="mainnet">Mainnet (Real Funds)</option>
          </select>

          {selectedNetwork === 'mainnet' && (
            <div className="flex items-start gap-2 text-[10px] text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>For mainnet, prefer the server-side wallet. Browser keys are session-only but still exposed to browser risk.</span>
            </div>
          )}

          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Base58 private key (memory only)"
            className="w-full bg-[#050509] border border-[#2d2e3d] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#c7f284]"
            autoComplete="off"
          />

          <button
            onClick={handleConnect}
            disabled={isConnecting || !keyInput.trim()}
            className="w-full flex items-center justify-center gap-2 bg-[#c7f284]/10 hover:bg-[#c7f284]/20 text-[#c7f284] border border-[#c7f284]/30 text-xs font-bold py-2 rounded-lg transition-all disabled:opacity-50"
          >
            {isConnecting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />}
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        </div>
      )}
    </div>
  );
}
