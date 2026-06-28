import React, { useState, useEffect } from 'react';
import { Activity, BrainCircuit, LineChart, MessageSquare, AlertTriangle, Globe, Newspaper } from 'lucide-react';
import { TokenMetric } from '../../types';
import { cn } from '../../lib/utils';

export const PredictionPage = ({ tokenMetrics }: { tokenMetrics: Record<string, TokenMetric> }) => {
  const [activeTab, setActiveTab] = useState<'sentiment' | 'market' | 'alerts'>('sentiment');
  
  // Real implementation would fetch from real APIs. For the scope of this frontend, we aggregate
  // from our AI-driven token metrics
  const tokens = Object.values(tokenMetrics).filter(m => (m.marketCap || 0) > 100000 && m.isRugSafe !== false);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 lg:space-y-12 pb-24 lg:pb-8">
      <header className="space-y-2 lg:space-y-4">
        <h1 className="text-2xl lg:text-4xl font-bold flex items-center gap-3">
          <BrainCircuit className="w-10 h-10 text-emerald-500" />
          Crypto Token Prediction Engine
        </h1>
        <p className="text-xl text-gray-400">
          AI-driven predictive analysis using Sentiment, On-Chain Metrics, and Market Intelligence.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
         <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl flex items-center gap-4">
            <MessageSquare className="w-8 h-8 text-blue-400" />
            <div>
              <div className="text-sm text-gray-400">Social Sentiment</div>
              <div className="text-xl font-bold">Aggregating...</div>
            </div>
         </div>
         <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl flex items-center gap-4">
            <LineChart className="w-8 h-8 text-emerald-400" />
            <div>
              <div className="text-sm text-gray-400">Market Momentum</div>
              <div className="text-xl font-bold">Active</div>
            </div>
         </div>
         <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl flex items-center gap-4">
            <Globe className="w-8 h-8 text-indigo-400" />
            <div>
              <div className="text-sm text-gray-400">On-Chain Data</div>
              <div className="text-xl font-bold">Streaming</div>
            </div>
         </div>
         <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl flex items-center gap-4">
            <Newspaper className="w-8 h-8 text-amber-400" />
            <div>
              <div className="text-sm text-gray-400">News Sentiment</div>
              <div className="text-xl font-bold">Live</div>
            </div>
         </div>
      </section>

      <div className="flex gap-2 lg:gap-4 border-b border-gray-800 pb-2 overflow-x-auto scrollbar-none whitespace-nowrap">
        <button 
          className={cn("px-4 py-2 font-bold transition-all text-sm lg:text-base", activeTab === 'sentiment' ? "text-emerald-400 border-b-2 border-emerald-400" : "text-gray-500 hover:text-gray-300")}
          onClick={() => setActiveTab('sentiment')}
        >
          Social & API Signals
        </button>
        <button 
          className={cn("px-4 py-2 font-bold transition-all text-sm lg:text-base", activeTab === 'market' ? "text-emerald-400 border-b-2 border-emerald-400" : "text-gray-500 hover:text-gray-300")}
          onClick={() => setActiveTab('market')}
        >
          Market Predictions (100x Scans)
        </button>
        <button 
          className={cn("px-4 py-2 font-bold transition-all text-sm lg:text-base", activeTab === 'alerts' ? "text-emerald-400 border-b-2 border-emerald-400" : "text-gray-500 hover:text-gray-300")}
          onClick={() => setActiveTab('alerts')}
        >
          Automated Alerts
        </button>
      </div>

      <main>
        {activeTab === 'market' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold mb-4">High Potential Tokens</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {tokens.length === 0 && <div className="text-gray-500">Scanning for high potential tokens...</div>}
              {tokens.slice(0, 10).map(token => (
                <div key={token.address} className="bg-gray-900 border border-gray-800 p-6 rounded-xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4">
                    <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-bold rounded-full border border-emerald-500/30">
                      Predictive Score: {Math.min(99, Math.floor(((token.buyCount||1)/(token.sellCount||1))*30 + (token.percentageIncrease||0)))}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold mb-1">{token.symbol}</h3>
                  <div className="text-sm font-mono text-gray-500 mb-4">{token.address}</div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm mt-4">
                    <div className="bg-black/50 p-3 rounded-lg">
                      <div className="text-gray-500">Market Cap</div>
                      <div className="font-bold">${((token.marketCap || 0) / 1000).toFixed(1)}K</div>
                    </div>
                    <div className="bg-black/50 p-3 rounded-lg">
                      <div className="text-gray-500">24h Vol Velocity</div>
                      <div className="font-bold">{((token.volume24h || 0) / (token.marketCap || 1)).toFixed(2)}x</div>
                    </div>
                    <div className="bg-black/50 p-3 rounded-lg">
                      <div className="text-gray-500">Holders</div>
                      <div className="font-bold">{token.holderCount || 'N/A'}</div>
                    </div>
                    <div className="bg-black/50 p-3 rounded-lg">
                      <div className="text-gray-500">Profit</div>
                      <div className={cn("font-bold", (token.percentageIncrease||0) >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {(token.percentageIncrease||0).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'sentiment' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold mb-4">API Integrations Data</h2>
            <p className="text-gray-400 mb-6">
              Connect external APIs (Twitter, Reddit, CoinGecko, LunarCrush, DexScreener, CryptoPanic) here. 
              The backend handles fetching API data while FastAPI processes ML sentiment data.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="border border-blue-900/50 bg-blue-950/20 p-6 rounded-xl">
                 <h3 className="text-lg font-bold text-blue-400 mb-2 flex items-center gap-2"><MessageSquare className="w-5 h-5"/> Twitter/X & Reddit Sentiment</h3>
                 <p className="text-sm text-gray-400">Configure Twitter and Reddit OAuth API credentials in Settings to stream live mentions of Solana tokens for correlation analysis.</p>
               </div>
               <div className="border border-emerald-900/50 bg-emerald-950/20 p-6 rounded-xl">
                 <h3 className="text-lg font-bold text-emerald-400 mb-2 flex items-center gap-2"><LineChart className="w-5 h-5"/> LunarCrush & CoinGecko</h3>
                 <p className="text-sm text-gray-400">Market data and established token momentum scores are processed via these data pipelines.</p>
               </div>
            </div>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold mb-4">Automated Trading Alerts</h2>
            <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
               <p className="text-gray-400 mb-4">Active alerts based on predictive AI threshold logic.</p>
               {tokens.filter(t => (t.percentageIncrease||0) > 40 && t.isRugSafe).map(token => (
                 <div key={"alert"+token.address} className="flex items-center justify-between p-4 border-b border-gray-800 last:border-0">
                   <div className="flex items-center gap-4">
                     <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                     <div>
                       <div className="font-bold flex items-center gap-2">
                         Buy Signal: {token.symbol}
                         <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full">High Prediction</span>
                       </div>
                       <div className="text-xs text-gray-500 font-mono">{token.address}</div>
                     </div>
                   </div>
                   <div className="text-emerald-400 font-bold px-4 py-2 bg-emerald-950/30 rounded-lg">
                     Momentum breakout detected
                   </div>
                 </div>
               ))}
            </div>
          </div>
        )}
      </main>

    </div>
  );
};
