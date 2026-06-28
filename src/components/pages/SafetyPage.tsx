import React from 'react';
import { ShieldCheck, Target, BrainCircuit, Activity, AlertTriangle, Zap, BarChart3, Users } from 'lucide-react';
import { TokenMetric } from '../../types';
import { cn } from '../../lib/utils';

export const SafetyPage = ({ tokenMetrics }: { tokenMetrics: Record<string, TokenMetric> }) => {
  const tokens = Object.values(tokenMetrics);

  const getAge = (timestamp: number) => {
    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  const filteredTokens = tokens.filter(token => {
    const profitPct = token.percentageIncrease || 0;
    const buyMomentum = (token.buyCount / (token.sellCount || 1)) >= 3;
    const isNew = (Date.now() - (token.discoveredAt || 0)) < 86400000; // Under 24h
    return profitPct > 50 && buyMomentum && isNew;
  });

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 lg:space-y-12">
      <header className="space-y-2 lg:space-y-4">
        <h1 className="text-2xl lg:text-4xl font-bold flex items-center gap-3">
          <ShieldCheck className="w-10 h-10 text-emerald-500" />
          Arina X-Ray Vision: Solana Intelligence Engine
        </h1>
        <p className="text-xl text-gray-400">
          Advanced AI-powered crypto intelligence. Filtering for &gt;50% Profit &amp; Momentum.
        </p>
      </header>
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <h2 className="text-2xl font-bold">Monitored Tokens ({filteredTokens.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTokens.length > 0 ? (
              filteredTokens.map(token => (
                <div key={token.address} className="bg-gray-900 border border-gray-800 p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-lg">{token.symbol}</h4>
                    <p 
                      className="text-xs text-gray-400 font-mono cursor-pointer hover:text-white"
                      onClick={() => navigator.clipboard.writeText(token.address)}
                      title="Click to copy address"
                    >
                      {token.address.slice(0, 6)}...{token.address.slice(-4)}
                    </p>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Age: {getAge(token.discoveredAt)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className={cn("px-2 py-1 rounded text-xs font-bold", token.isRugSafe ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500")}>
                      {token.isRugSafe ? "SAFE" : "RISKY"}
                    </div>
                    {token.percentageIncrease !== undefined && (
                      <div className={cn("text-xs font-medium", token.percentageIncrease >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {token.percentageIncrease > 0 ? '+' : ''}{token.percentageIncrease.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-gray-500 py-10 col-span-2">
                No tokens meeting criteria detected yet. Waiting for scanner...
              </div>
            )}
          </div>
        </div>
        
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
            <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Zap className="w-6 h-6 text-yellow-500" />
              Criteria Active
            </h3>
            <ul className="text-gray-300 text-sm list-disc pl-5 space-y-2">
              <li>Profit &gt; 50%</li>
              <li>Momentum (Buy/Ratio &gt;= 3)</li>
              <li>Newly Migrated (&lt; 24h old)</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};
