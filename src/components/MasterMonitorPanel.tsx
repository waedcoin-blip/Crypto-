import React, { useState, useEffect } from 'react';
import { masterMonitorHealthManager, MasterMonitorStatus } from '../services/MasterMonitorHealthManager';

interface MasterMonitorPanelProps {
  rpcUrl?: string; // Execution primary URL (used only to indicate fallback if master_monitor_rpc is blank)
  masterMonitorRpc: string;
  setMasterMonitorRpc: (val: string) => void;
  masterMonitorRpc2: string;
  setMasterMonitorRpc2: (val: string) => void;
  masterMonitorWs: string;
  setMasterMonitorWs: (val: string) => void;
}

export const MasterMonitorPanel: React.FC<MasterMonitorPanelProps> = ({
  rpcUrl = '',
  masterMonitorRpc,
  setMasterMonitorRpc,
  masterMonitorRpc2,
  setMasterMonitorRpc2,
  masterMonitorWs,
  setMasterMonitorWs,
}) => {
  const [status, setStatus] = useState<MasterMonitorStatus>(() => masterMonitorHealthManager.getStatus());
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    const unsub = masterMonitorHealthManager.onChange((newStatus) => {
      setStatus(newStatus);
    });
    return unsub;
  }, []);

  const handleTestConnection = async () => {
    setIsTesting(true);
    // Push updated values into HealthManager
    masterMonitorHealthManager.setEndpoints(masterMonitorRpc, masterMonitorRpc2, masterMonitorWs);
    const res = await masterMonitorHealthManager.testConnection();
    setStatus(res);
    setIsTesting(false);
  };

  const formatTimestamp = (ts: number | null) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleTimeString();
  };

  const getStatusColor = (st: MasterMonitorStatus['status']) => {
    switch (st) {
      case 'LIVE': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'CONNECTING': return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
      case 'DEGRADED': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'BACKUP': return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30';
      case 'OFFLINE': return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    }
  };

  const isCustomEngaged = !!(masterMonitorRpc && masterMonitorRpc.trim() !== '');

  return (
    <div className="p-4 bg-sky-950/20 border border-sky-500/30 rounded-2xl space-y-3.5 shadow-lg relative overflow-hidden">
      {status.status === 'OFFLINE' && isCustomEngaged && (
        <div className="text-[10px] text-rose-400 font-semibold bg-rose-950/25 border border-rose-500/30 p-2 rounded-xl text-center">
          ⚠️ DEDICATED MONITOR OFFLINE — NOT USING EXECUTION RPC
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-sky-500/20 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-lg">📡</span>
          <div>
            <h3 className="text-[13px] font-bold text-sky-300 uppercase tracking-wider">
              MASTER MONITOR
            </h3>
            <p className="text-[10px] text-sky-400/70 font-mono">
              Independent Pipeline for Discovery, Telemetry & Terminal Logs
            </p>
          </div>
        </div>
        <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border ${getStatusColor(status.status)} flex items-center gap-1.5`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          {status.status.toUpperCase()}
        </span>
      </div>

      {/* Input 1: RPC Endpoint */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <label className="font-semibold text-sky-200">RPC Endpoint</label>
          <span className="text-[10px] text-sky-400/80 font-mono">
            {isCustomEngaged ? '● DEDICATED MONITOR NODE' : '○ NOT CONFIGURED (OFFLINE)'}
          </span>
        </div>
        <input
          type="text"
          value={masterMonitorRpc}
          onChange={(e) => {
            setMasterMonitorRpc(e.target.value);
            masterMonitorHealthManager.setEndpoints(e.target.value, masterMonitorRpc2, masterMonitorWs);
          }}
          placeholder="https://mainnet.helius-rpc.com/?api-key=..."
          className="w-full bg-[#050b14] border border-sky-500/30 rounded-xl px-3 py-2 text-[12px] text-white font-mono focus:outline-none focus:border-sky-400 transition-colors placeholder:text-slate-600"
        />
      </div>

      {/* Input 2: Backup RPC Endpoint */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <label className="font-semibold text-sky-200">Backup RPC Endpoint (Optional)</label>
          <span className="text-[10px] text-sky-400/70 font-mono">Monitoring Failover Only</span>
        </div>
        <input
          type="text"
          value={masterMonitorRpc2}
          onChange={(e) => {
            setMasterMonitorRpc2(e.target.value);
            masterMonitorHealthManager.setEndpoints(masterMonitorRpc, e.target.value, masterMonitorWs);
          }}
          placeholder="https://solana-mainnet.g.alchemy.com/v2/..."
          className="w-full bg-[#050b14] border border-sky-500/20 rounded-xl px-3 py-2 text-[12px] text-white font-mono focus:outline-none focus:border-sky-400 transition-colors placeholder:text-slate-600"
        />
      </div>

      {/* Input 3: WebSocket Endpoint */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <label className="font-semibold text-sky-200">WebSocket Endpoint (Optional)</label>
          <span className="text-[10px] text-sky-400/70 font-mono">wss://</span>
        </div>
        <input
          type="text"
          value={masterMonitorWs}
          onChange={(e) => {
            setMasterMonitorWs(e.target.value);
            masterMonitorHealthManager.setEndpoints(masterMonitorRpc, masterMonitorRpc2, e.target.value);
          }}
          placeholder="wss://mainnet.helius-rpc.com/..."
          className="w-full bg-[#050b14] border border-sky-500/20 rounded-xl px-3 py-2 text-[12px] text-white font-mono focus:outline-none focus:border-sky-400 transition-colors placeholder:text-slate-600"
        />
      </div>

      {/* Test Connection Button & Status Readout */}
      <div className="pt-2 border-t border-sky-500/20 space-y-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="px-3 py-1.5 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 rounded-xl text-[11px] font-bold text-sky-200 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
          >
            {isTesting ? (
              <>
                <span className="w-3 h-3 border-2 border-sky-300 border-t-transparent rounded-full animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <span>⚡</span>
                Test Connection
              </>
            )}
          </button>

          <span className="text-[10px] text-sky-300/80 font-mono">
            Active: <span className="text-white font-semibold">{status.activeUrl ? status.activeUrl.substring(0, 28) + '...' : 'None'}</span>
          </span>
        </div>

        {/* Live Status Diagnostics Grid */}
        <div className="grid grid-cols-3 gap-2 bg-[#040810]/80 p-2.5 rounded-xl border border-sky-500/20 font-mono text-[11px]">
          <div>
            <div className="text-[9px] text-sky-400/60 uppercase font-bold">Latency</div>
            <div className={`font-bold ${status.latencyMs !== null ? (status.latencyMs < 200 ? 'text-emerald-400' : 'text-amber-400') : 'text-slate-500'}`}>
              {status.latencyMs !== null ? `${status.latencyMs} ms` : '--'}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-sky-400/60 uppercase font-bold">Slot</div>
            <div className="font-bold text-sky-200 truncate">
              {status.slot !== null ? status.slot.toLocaleString() : '--'}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-sky-400/60 uppercase font-bold">Last Update</div>
            <div className="font-bold text-slate-300 truncate">
              {formatTimestamp(status.lastUpdated)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
