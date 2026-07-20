import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, Play } from 'lucide-react';
import { Connection } from '@solana/web3.js';
import { getJupiterQuote } from '../../services/jupiterService';

export const SystemCheckPage = ({
  rpcUrl
}: {
  rpcUrl: string;
}) => {
  const [isTesting, setIsTesting] = useState(false);
  const [results, setResults] = useState<{
    rpcUrl: { status: 'idle' | 'testing' | 'success' | 'error', details: string },
    jupiterApi: { status: 'idle' | 'testing' | 'success' | 'error', details: string },
  }>({
    rpcUrl: { status: 'idle', details: '' },
    jupiterApi: { status: 'idle', details: '' },
  });

  const runTests = async () => {
    setIsTesting(true);
    // Reset status
    setResults({
      rpcUrl: { status: 'testing', details: '' },
      jupiterApi: { status: 'testing', details: '' },
    });

    // Test 1: RPC URL
    try {
      const connection = new Connection(rpcUrl, 'confirmed');
      const start = performance.now();
      const blockhash = await connection.getLatestBlockhash();
      const rpcDuration = performance.now() - start;
      if (blockhash && blockhash.blockhash) {
        setResults(prev => ({
          ...prev,
          rpcUrl: { status: 'success', details: `Latency: ${rpcDuration.toFixed(2)}ms. Connected to Solana Mainnet.` }
        }));
      } else {
        throw new Error("Invalid response from RPC blockhash request.");
      }
    } catch (e: any) {
      setResults(prev => ({
        ...prev,
        rpcUrl: { status: 'error', details: e.message || 'Failed to connect to RPC node.' }
      }));
    }

    // Test 2: Jupiter API Quote
    try {
      const start = performance.now();
      const quote = await getJupiterQuote(
        'So11111111111111111111111111111111111111112', // SOL
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        10000000, 
        100 
      );
      const jupDuration = performance.now() - start;
      if (quote && quote.outAmount) {
        setResults(prev => ({
          ...prev,
          jupiterApi: { status: 'success', details: `Latency: ${jupDuration.toFixed(2)}ms. Available route found (SOL -> USDC).` }
        }));
      } else {
        throw new Error("No route found or API rate limit.");
      }
    } catch (e: any) {
         if(e.message && e.message.includes('NO_ROUTES_FOUND')) {
             setResults(prev => ({
                ...prev,
                jupiterApi: { status: 'error', details: 'Jupiter returned NO_ROUTES_FOUND. This could be due to geoblocking or temporary API issue.' }
             }));
         } else {
            setResults(prev => ({
                ...prev,
                jupiterApi: { status: 'error', details: e.message || 'Jupiter Quote failed.' }
            }));
         }
    }

    setIsTesting(false);
  };

  const TestItem = ({ title, result }: { title: string, result: { status: string, details: string } }) => {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex gap-4 items-start">
        <div className="mt-1">
          {result.status === 'idle' && <div className="w-5 h-5 rounded-full border border-slate-600"></div>}
          {result.status === 'testing' && <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />}
          {result.status === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          {result.status === 'error' && <XCircle className="w-5 h-5 text-red-400" />}
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-slate-200">{title}</h3>
          {(result.details || result.status === 'testing') && (
            <p className={`text-sm mt-1 ${result.status === 'error' ? 'text-red-400' : 'text-slate-400'}`}>
              {result.status === 'testing' ? 'Testing connection...' : result.details}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-white tracking-tight">System Readiness Check</h1>
            <p className="text-slate-400 mt-1 text-xs lg:text-sm">Run tests to ensure APIs, routing, and connections are nominal before auto trading.</p>
          </div>
          <button 
            onClick={runTests}
            disabled={isTesting}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            {isTesting ? 'Running Checks...' : 'Run All Tests'}
          </button>
        </div>

        <div className="grid gap-3">
          <TestItem title="Solana RPC Connection" result={results.rpcUrl} />
          <TestItem title="Jupiter Limit Order & Swap API" result={results.jupiterApi} />
        </div>
        
        <div className="bg-blue-900/20 border border-blue-900 rounded-xl p-4 mt-6">
          <h3 className="font-semibold text-blue-400 mb-2">Bot Requirement Checklist</h3>
          <ul className="text-sm text-blue-300/80 space-y-2 list-disc list-inside">
            <li>Your <strong>RPC URL</strong> must be fast and allow significant burst limits. Public RPCs (like Mainnet Beta) may randomly fail during high network volume.</li>
            <li>Your <strong>Jupiter API</strong> connection ensures the bot can price discoveries instantly. Note that some IP regions block Jupiter.</li>
            <li>If the wallet is properly connected and funded with SOL (Minimum recommended: ~0.5), PnL & AutoSniper will start working smoothly without routing bugs.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
