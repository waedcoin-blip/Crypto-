import React, { useState, useEffect } from 'react';
import { syncManager, SyncStatus } from '../services/SyncService';
import { Cloud, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';

export const SyncStatusBadge: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [status, setStatus] = useState<SyncStatus>(syncManager.getStatus());

  useEffect(() => {
    const unsubscribe = syncManager.subscribe((newStatus) => {
      setStatus(newStatus);
    });
    return unsubscribe;
  }, []);

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono border transition-all ${
      status.isSyncing 
        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' 
        : status.renderSynced && status.firebaseSynced
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
        : 'bg-[#1b1c26] border-[#2d2e3d] text-[#94a3b8]'
    } ${className}`}>
      {status.isSyncing ? (
        <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
      ) : (
        <span className={`w-1.5 h-1.5 rounded-full ${
          status.renderSynced || status.firebaseSynced ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'
        }`} />
      )}
      <span>
        {status.isSyncing
          ? 'Syncing Render & Firebase...'
          : 'Render & Firebase Live'}
      </span>
    </div>
  );
};
