// src/components/LogPanel.tsx
import React from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import { useAppStore, LogEvent } from '../store/appStore';

const TYPE_COLORS: Record<LogEvent['type'], string> = {
  info: 'text-slate-300',
  success: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-rose-400',
  system: 'text-indigo-400',
};

export function LogPanel() {
  const logs = useAppStore((s) => s.logs);
  const clearLogs = useAppStore((s) => s.clearLogs);

  return (
    <div className="bg-[#0f111a] border border-[#2d2e3d] rounded-xl flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between p-3 border-b border-[#2d2e3d]">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#c7f284]" />
          <h3 className="text-sm font-bold text-white">System Log</h3>
        </div>
        <button
          onClick={clearLogs}
          className="p-1.5 hover:bg-[#232638] rounded transition-colors"
          title="Clear logs"
        >
          <Trash2 className="w-3 h-3 text-slate-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-[10px]">
        {logs.length === 0 ? (
          <div className="text-center text-[#64748b] py-8">No logs yet</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2">
              <span className="text-[#4a5568] flex-shrink-0">{log.time}</span>
              <span className={TYPE_COLORS[log.type]}>
                {log.msg}
                {log.count && log.count > 1 && (
                  <span className="ml-1 text-[#64748b]">×{log.count}</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
