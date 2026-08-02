import React, { useState, useEffect } from 'react';
import { Terminal, Trash2, ShieldCheck, Activity } from 'lucide-react';

export interface JupiterLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export const JupiterSystemLog: React.FC = () => {
  const [logs, setLogs] = useState<JupiterLogEntry[]>([]);

  useEffect(() => {
    const loadLogs = () => {
      const saved = localStorage.getItem('jupiter_standalone_logs');
      if (saved) {
        try {
          setLogs(JSON.parse(saved));
        } catch {
          setLogs([]);
        }
      } else {
        const initialLog: JupiterLogEntry[] = [
          {
            id: 'init-1',
            timestamp: new Date().toLocaleTimeString(),
            level: 'success',
            message: 'Jupiter Standalone Trading Engine initialized successfully.'
          }
        ];
        setLogs(initialLog);
        localStorage.setItem('jupiter_standalone_logs', JSON.stringify(initialLog));
      }
    };
    loadLogs();
    const interval = setInterval(loadLogs, 2000);
    return () => clearInterval(interval);
  }, []);

  const clearLogs = () => {
    const fresh: JupiterLogEntry[] = [
      {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        message: 'System logs cleared.'
      }
    ];
    setLogs(fresh);
    localStorage.setItem('jupiter_standalone_logs', JSON.stringify(fresh));
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-xl font-mono space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Jupiter System Log (Single Source of Truth)
          </span>
        </div>
        <button
          onClick={clearLogs}
          className="p-1.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
          title="Clear Logs"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="bg-slate-900/90 rounded-xl p-3 h-52 overflow-y-auto space-y-1.5 text-[11px] border border-slate-800/80">
        {logs.map((log) => {
          let color = 'text-slate-300';
          if (log.level === 'success') color = 'text-emerald-400';
          if (log.level === 'warning') color = 'text-amber-400';
          if (log.level === 'error') color = 'text-rose-400';

          return (
            <div key={log.id} className="flex items-start gap-2 leading-relaxed">
              <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
              <span className={`${color} break-all font-mono`}>{log.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
