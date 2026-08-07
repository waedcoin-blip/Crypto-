// src/components/TradeModeToggle.tsx
import React from 'react';
import { useTradeMode } from '../context/TradeModeContext';

export const TradeModeToggle: React.FC = () => {
  const { mode, setMode } = useTradeMode();

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-700/80 bg-[#0c0d14] p-1.5">
      <button
        onClick={() => setMode('paper')}
        className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
          mode === 'paper'
            ? 'bg-white text-black shadow'
            : 'text-gray-400 hover:text-white'
        }`}
      >
        Paper
      </button>
      <button
        onClick={() => setMode('real')}
        className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
          mode === 'real'
            ? 'bg-red-600 text-white shadow'
            : 'text-gray-400 hover:text-red-400'
        }`}
      >
        Live
      </button>
      {mode === 'real' && (
        <span className="text-[11px] text-red-500 font-bold tracking-wider animate-pulse px-1">
          REAL FUNDS AT RISK
        </span>
      )}
    </div>
  );
};
