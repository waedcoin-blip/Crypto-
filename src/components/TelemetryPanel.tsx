// src/components/TelemetryPanel.tsx
import React from 'react';
import { Radio, Zap, AlertTriangle, ArrowUpRight, TrendingUp } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { TelemetryAlert } from '../types';

const BADGE_MAP: Record<string, { bg: string; text: string; border: string }> = {
  WHALE_BUY: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  MIGRATED: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/30' },
  VOLUME_SPIKE: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  HIGH_FREQUENCY_BUY: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  DEFAULT: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/30' },
};

export function TelemetryPanel() {
  const alerts = useAppStore((s) => s.telemetryAlerts);

  return (
    <div className="bg-[#0f111a] border border-[#2d2e3d] rounded-xl overflow-hidden flex flex-col h-72">
      <div className="flex items-center justify-between p-3 border-b border-[#2d2e3d] bg-[#050509]">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#c7f284]" />
          <h3 className="text-sm font-bold text-white">Live Telemetry & Signals</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-[#64748b] uppercase font-mono">Stream Active</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {alerts.length === 0 ? (
          <div className="text-center text-[#64748b] text-xs py-12">
            No telemetry alerts yet. Streaming LaserStream & PumpPortal market events...
          </div>
        ) : (
          alerts.map((alert) => {
            const badge = BADGE_MAP[alert.type] || BADGE_MAP.DEFAULT;
            const timeStr = new Date(alert.timestamp).toLocaleTimeString();

            return (
              <div
                key={alert.id}
                className="bg-[#050509] border border-[#1f212e] hover:border-[#2d2e3d] rounded-lg p-2.5 transition-colors flex items-start justify-between gap-3 text-xs"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${badge.bg} ${badge.text} ${badge.border}`}
                    >
                      {alert.type}
                    </span>
                    <span className="font-bold text-white font-mono">{alert.token}</span>
                    <span className="text-[10px] text-[#64748b] font-mono">
                      {alert.address ? `${alert.address.slice(0, 4)}...${alert.address.slice(-4)}` : ''}
                    </span>
                  </div>
                  <div className="text-slate-300 text-[11px] leading-relaxed break-words">
                    {alert.message}
                  </div>
                </div>
                <div className="text-[10px] text-[#4a5568] font-mono flex-shrink-0">
                  {timeStr}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
