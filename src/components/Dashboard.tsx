// src/components/Dashboard.tsx
import React, { useEffect } from 'react';
import { Activity, Radio } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useSupervisor } from '../hooks/useSupervisor';
import { usePositions } from '../hooks/usePositions';
import { startAlertManager } from '../engines/alertManager';
import { WalletPanel } from './WalletPanel';
import { ActivePositionsTable } from './ActivePositionsTable';
import { TelemetryPanel } from './TelemetryPanel';
import { LogPanel } from './LogPanel';
import { CriteriaPanel } from './CriteriaPanel';

export function Dashboard() {
  const { status: supervisorStatus, isConnected, startTrading, stopTrading } = useSupervisor();
  const { portfolioPnL } = usePositions(3000);
  const addLog = useAppStore((s) => s.addLog);
  const setSupervisorState = useAppStore((s) => s.setSupervisorState);
  const setConnected = useAppStore((s) => s.setConnected);
  const setPortfolioPnL = useAppStore((s) => s.setPortfolioPnL);
  const tradeMode = useAppStore((s) => s.tradeMode);
  const autoSniperEnabled = useAppStore((s) => s.autoSniperEnabled);
  const setSettings = useAppStore((s) => s.setSettings);

  // ---- Sync supervisor state into the unified store ----
  useEffect(() => {
    if (supervisorStatus) {
      setSupervisorState(supervisorStatus.state);
    }
  }, [supervisorStatus, setSupervisorState]);

  useEffect(() => {
    setConnected(isConnected);
  }, [isConnected, setConnected]);

  useEffect(() => {
    setPortfolioPnL(portfolioPnL);
  }, [portfolioPnL, setPortfolioPnL]);

  // ---- Start telemetry alert manager once ----
  useEffect(() => {
    startAlertManager();
    addLog('🟢 [SYSTEM] Dashboard initialized. All trading authority delegated to backend.', 'system');
  }, [addLog]);

  const isTrading = supervisorStatus?.state === 'TRADING';

  const handleToggleTrading = async () => {
    if (isTrading) {
      await stopTrading();
      addLog('🛑 [SYSTEM] Trading stopped via backend', 'warn');
    } else {
      await startTrading({ network: tradeMode });
      addLog(`🚀 [SYSTEM] Trading started on ${tradeMode}`, 'success');
    }
  };

  return (
    <div className="min-h-screen bg-[#050509] text-slate-200">
      {/* ---- Header ---- */}
      <header className="border-b border-[#2d2e3d] bg-[#0a0b12] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#c7f284]/10 border border-[#c7f284]/30 flex items-center justify-center">
            <Activity className="w-4 h-4 text-[#c7f284]" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">ARINA X-RAY ALPHA</h1>
            <p className="text-[10px] text-[#64748b]">Backend-Authoritative Trading</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Connection status */}
          <div className="flex items-center gap-2">
            <Radio className={`w-3 h-3 ${isConnected ? 'text-emerald-400' : 'text-rose-400'}`} />
            <span className="text-[10px] text-[#64748b]">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {/* Supervisor state badge */}
          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
            isTrading
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
              : 'bg-slate-500/10 text-slate-400 border border-slate-500/30'
          }`}>
            {supervisorStatus?.state || 'STOPPED'}
          </span>

          {/* Start/Stop button */}
          <button
            onClick={handleToggleTrading}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              isTrading
                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
            }`}
          >
            {isTrading ? 'Stop Trading' : 'Start Trading'}
          </button>
        </div>
      </header>

      {/* ---- Main Grid ---- */}
      <div className="grid grid-cols-12 gap-4 p-6">
        {/* Left column: Wallet + Criteria */}
        <div className="col-span-3 space-y-4">
          <WalletPanel />
          <CriteriaPanel />
        </div>

        {/* Center column: Positions + Telemetry */}
        <div className="col-span-6 space-y-4">
          <ActivePositionsTable />
          <TelemetryPanel />
        </div>

        {/* Right column: Logs */}
        <div className="col-span-3">
          <LogPanel />
        </div>
      </div>
    </div>
  );
}
