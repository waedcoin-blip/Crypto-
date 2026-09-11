// src/components/CriteriaPanel.tsx
import React, { useState } from 'react';
import { Sliders, RefreshCw, RotateCcw, Check, Sparkles } from 'lucide-react';
import { useCriteria } from '../hooks/useCriteria';

export function CriteriaPanel() {
  const { criteria, isLoading, error, updateCriteria, resetCriteria, applyPreset } = useCriteria();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});

  const handleStartEdit = () => {
    setFormData(criteria || {});
    setIsEditing(true);
  };

  const handleSave = async () => {
    const success = await updateCriteria(formData);
    if (success) {
      setIsEditing(false);
    }
  };

  return (
    <div className="bg-[#0f111a] border border-[#2d2e3d] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[#c7f284]" />
          <h3 className="text-sm font-bold text-white">Trading Criteria</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => resetCriteria()}
            title="Reset to defaults"
            className="p-1 hover:bg-[#232638] rounded text-slate-400 hover:text-white transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {error && (
        <div className="text-[10px] text-rose-400 bg-rose-500/10 p-2 rounded border border-rose-500/20">
          {error}
        </div>
      )}

      {/* Preset Pills */}
      <div className="flex items-center gap-1.5 pt-1">
        <span className="text-[10px] text-[#64748b] mr-1">Presets:</span>
        {['conservative', 'balanced', 'aggressive'].map((preset) => (
          <button
            key={preset}
            onClick={() => applyPreset(preset)}
            className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#1a1c28] hover:bg-[#242738] text-slate-300 hover:text-[#c7f284] border border-[#2d2e3d] transition-all capitalize"
          >
            {preset}
          </button>
        ))}
      </div>

      {/* Key Metric Rows */}
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <div className="bg-[#050509] p-2 rounded border border-[#1f212e]">
          <div className="text-[10px] text-[#64748b] uppercase">Min Liquidity</div>
          <div className="text-white font-bold">
            ${criteria?.minLiquidityUsd ? Number(criteria.minLiquidityUsd).toLocaleString() : '1,000'}
          </div>
        </div>
        <div className="bg-[#050509] p-2 rounded border border-[#1f212e]">
          <div className="text-[10px] text-[#64748b] uppercase">Max Risk Score</div>
          <div className="text-amber-400 font-bold">
            {criteria?.maxRiskScore ?? 65} / 100
          </div>
        </div>
        <div className="bg-[#050509] p-2 rounded border border-[#1f212e]">
          <div className="text-[10px] text-[#64748b] uppercase">Take Profit</div>
          <div className="text-emerald-400 font-bold">
            +{criteria?.minTakeProfit ?? 25}%
          </div>
        </div>
        <div className="bg-[#050509] p-2 rounded border border-[#1f212e]">
          <div className="text-[10px] text-[#64748b] uppercase">Stop Loss</div>
          <div className="text-rose-400 font-bold">
            -{criteria?.stopLoss ?? 15}%
          </div>
        </div>
      </div>

      <div className="text-[10px] text-[#64748b] flex items-center gap-1.5 pt-1">
        <Sparkles className="w-3 h-3 text-[#c7f284]" />
        <span>Enforced server-side via HardenedCriteriaEngine</span>
      </div>
    </div>
  );
}
