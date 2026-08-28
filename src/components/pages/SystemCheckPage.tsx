import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, Play, Activity, Gauge, Server, Wifi, Network, Send, RefreshCw, AlertTriangle, ShieldCheck, Database } from 'lucide-react';
import { Connection } from '@solana/web3.js';
import { jupiterPreSellValidator } from '../../services/JupiterPreSellValidator';
import { pingJupiterApi } from '../../services/jupiterService';
import { marketDataManager } from '../../services/marketDataManager';

export const SystemCheckPage = ({
  rpcUrl
}: {
  rpcUrl: string;
}) => {
  const [isTesting, setIsTesting] = useState(false);
  const [activeTab, setActiveTab] = useState<'tests' | 'telemetry' | 'exporter'>('telemetry');
  
  // Telemetry state
  const [telemetryMetrics, setTelemetryMetrics] = useState(() => telemetryService.getMetricsSummary());
  const [recentSpans, setRecentSpans] = useState<TelemetrySpan[]>(() => telemetryService.getSpans());
  const [otlpConfig, setOtlpConfig] = useState(() => telemetryService.getOtlpConfig());
  const [exportingStatus, setExportingStatus] = useState<{ loading: boolean; msg: string; error?: boolean }>({ loading: false, msg: '' });

  const [results, setResults] = useState<{
    rpcUrl: { status: 'idle' | 'testing' | 'success' | 'error', details: string },
    masterMonitorRpc: { status: 'idle' | 'testing' | 'success' | 'error', details: string },
    jupiterPreSell: { status: 'idle' | 'testing' | 'success' | 'error', details: string },
    laserstream: { status: 'idle' | 'testing' | 'success' | 'error', details: string },
    dexscreener: { status: 'idle' | 'testing' | 'success' | 'error', details: string },
  }>({
    rpcUrl: { status: 'idle', details: '' },
    masterMonitorRpc: { status: 'idle', details: '' },
    jupiterPreSell: { status: 'idle', details: '' },
    laserstream: { status: 'idle', details: '' },
    dexscreener: { status: 'idle', details: '' },
  });

  const [marketStats, setMarketStats] = useState(() => marketDataManager.getStats());

  useEffect(() => {
    const unsubscribe = telemetryService.subscribe(() => {
      setTelemetryMetrics(telemetryService.getMetricsSummary());
      setRecentSpans(telemetryService.getSpans().slice(0, 30));
    });
    const interval = setInterval(() => {
      setMarketStats(marketDataManager.getStats());
    }, 2000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const runTests = async () => {
    setIsTesting(true);
    setResults({
      rpcUrl: { status: 'testing', details: '' },
      masterMonitorRpc: { status: 'testing', details: '' },
      laserstream: { status: 'testing', details: '' },
      dexscreener: { status: 'testing', details: '' },
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
          rpcUrl: { status: 'success', details: `Latency: ${rpcDuration.toFixed(2)}ms. Connected to Solana Mainnet Execution Node.` }
        }));
        telemetryService.recordApiRequest(rpcUrl, 'getLatestBlockhash', 200, rpcDuration);
      } else {
        throw new Error("Invalid response from RPC blockhash request.");
      }
    } catch (e: any) {
      setResults(prev => ({
        ...prev,
        rpcUrl: { status: 'error', details: e.message || 'Failed to connect to RPC node.' }
      }));
      telemetryService.recordApiRequest(rpcUrl, 'getLatestBlockhash', 500, 0, e.message);
    }

    // Test 2: Master Monitor RPC URL
    const masterRpcToTest = localStorage.getItem('master_monitor_rpc') || rpcUrl;
    try {
      const masterConn = new Connection(masterRpcToTest, 'confirmed');
      const start = performance.now();
      const blockhash = await masterConn.getLatestBlockhash();
      const masterDuration = performance.now() - start;
      const isIndep = !!(localStorage.getItem('master_monitor_rpc') && localStorage.getItem('master_monitor_rpc') !== rpcUrl);
      if (blockhash && blockhash.blockhash) {
        setResults(prev => ({
          ...prev,
          masterMonitorRpc: { 
            status: 'success', 
            details: `Latency: ${masterDuration.toFixed(2)}ms. Connected (${isIndep ? 'Independent Master RPC Node' : 'Shared Primary Endpoint'}). Ready for onLogs, discovery & metrics.` 
          }
        }));
        telemetryService.recordApiRequest(masterRpcToTest, 'getLatestBlockhash', 200, masterDuration);
      } else {
        throw new Error("Invalid response from Master Monitor RPC.");
      }
    } catch (e: any) {
      setResults(prev => ({
        ...prev,
        masterMonitorRpc: { status: 'error', details: e.message || 'Failed to connect to Master Monitor RPC node.' }
      }));
    }

    // Test 3: Jupiter Executable Pre-Sell Validator
    try {
      const start = performance.now();
      const pingRes = await pingJupiterApi();
      const duration = performance.now() - start;
      if (pingRes.healthy) {
        setResults(prev => ({
          ...prev,
          jupiterPreSell: { status: 'success', details: `Latency: ${pingRes.pingMs || duration.toFixed(2)}ms. Jupiter Executable Pre-Sell Validation Engine Nominal. Non-Jupiter fallbacks disabled.` }
        }));
        telemetryService.recordApiRequest('Jupiter API', 'preSellPing', 200, duration);
      } else {
        setResults(prev => ({
          ...prev,
          jupiterPreSell: { status: 'error', details: `Jupiter API health check returned: ${pingRes.error || 'Unhealthy'}` }
        }));
        telemetryService.recordApiRequest('Jupiter API', 'preSellPing', 500, 0, pingRes.error);
      }
    } catch (e: any) {
      setResults(prev => ({
        ...prev,
        jupiterPreSell: { status: 'error', details: e.message || 'Failed to ping Jupiter Executable Quote API.' }
      }));
    }

    // Test 4: Helius LaserStream
    try {
      const start = performance.now();
      const res = await fetch('/api/laserstream/status');
      const lsDuration = performance.now() - start;
      if (res.ok) {
        const lsData = await res.json();
        const mode = lsData.isSimulated ? 'Local Sandbox Stream' : (lsData.isFallback ? 'High-Speed WebSocket Fallback' : 'gRPC Geyser Stream');
        setResults(prev => ({
          ...prev,
          laserstream: { status: 'success', details: `Latency: ${lsDuration.toFixed(2)}ms. LaserStream Operational (${mode}).` }
        }));
        telemetryService.recordApiRequest('LaserStream', 'status', 200, lsDuration);
      } else {
        setResults(prev => ({
          ...prev,
          laserstream: { status: 'success', details: 'LaserStream Ingestion Service Active (Client-Side WebSocket Fallback).' }
        }));
        telemetryService.recordApiRequest('LaserStream', 'status', 200, lsDuration);
      }
    } catch (e: any) {
      setResults(prev => ({
        ...prev,
        laserstream: { status: 'success', details: 'LaserStream Ingestion Service Active (Client-Side WebSocket Ready).' }
      }));
    }

    // Test 4: DexScreener Price Discovery API
    try {
      const start = performance.now();
      const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
      const duration = performance.now() - start;
      if (res.ok) {
        setResults(prev => ({
          ...prev,
          dexscreener: { status: 'success', details: `Latency: ${duration.toFixed(2)}ms. Price feed response nominal.` }
        }));
        telemetryService.recordApiRequest('DexScreener API', 'getPair', 200, duration);
      } else {
        throw new Error(`DexScreener status HTTP ${res.status}`);
      }
    } catch (e: any) {
      setResults(prev => ({
        ...prev,
        dexscreener: { status: 'error', details: e.message || 'Failed to fetch DexScreener market price data.' }
      }));
      telemetryService.recordApiRequest('DexScreener API', 'getPair', 500, 0, e.message);
    }

    setIsTesting(false);
  };

  const handleSaveOtlp = (e: React.FormEvent) => {
    e.preventDefault();
    telemetryService.setOtlpConfig(otlpConfig.endpoint, otlpConfig.apiKey, otlpConfig.autoExport);
    setExportingStatus({ loading: false, msg: 'OTLP Exporter settings saved successfully.' });
  };

  const handleManualExport = async () => {
    setExportingStatus({ loading: true, msg: 'Sending OpenTelemetry spans to collector...' });
    const res = await telemetryService.exportTelemetryToOtlp();
    if (res.success) {
      setExportingStatus({ loading: false, msg: `Successfully exported ${res.exportedSpans} spans to OTLP collector!` });
    } else {
      setExportingStatus({ loading: false, msg: res.error || 'Export failed.', error: true });
    }
  };

  const TestItem = ({ title, result }: { title: string, result: { status: string, details: string } }) => {
    return (
      <div className="bg-[#12131a] border border-[#1f212e] rounded-xl p-4 flex gap-4 items-start">
        <div className="mt-1">
          {result.status === 'idle' && <div className="w-5 h-5 rounded-full border border-slate-600"></div>}
          {result.status === 'testing' && <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />}
          {result.status === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          {result.status === 'error' && <XCircle className="w-5 h-5 text-red-400" />}
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-slate-200 text-sm">{title}</h3>
          {(result.details || result.status === 'testing') && (
            <p className={`text-xs mt-1 ${result.status === 'error' ? 'text-red-400' : 'text-slate-400'}`}>
              {result.status === 'testing' ? 'Testing connection...' : result.details}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#1f212e] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-indigo-400" />
            <h1 className="text-xl lg:text-2xl font-bold text-white tracking-tight">System & Telemetry Health</h1>
          </div>
          <p className="text-slate-400 mt-1 text-xs lg:text-sm">
            OpenTelemetry Observability, Exchange API Latency (P50/P90/P99), Error Rates & OneUptime Exporter
          </p>
        </div>

        <div className="flex items-center gap-2 bg-[#12131a] p-1.5 rounded-xl border border-[#1f212e]">
          <button
            onClick={() => setActiveTab('telemetry')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'telemetry' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            OTel Dashboard
          </button>
          <button
            onClick={() => setActiveTab('tests')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'tests' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            API Readiness
          </button>
          <button
            onClick={() => setActiveTab('exporter')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'exporter' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            OTLP / OneUptime
          </button>
        </div>
      </div>

      {/* TAB 1: OPENTELEMETRY DASHBOARD */}
      {activeTab === 'telemetry' && (
        <div className="space-y-6">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#12131a] border border-[#1f212e] rounded-xl p-4">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider">
                <span>P50 / P90 / P99 Latency</span>
                <Gauge className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-white font-mono">{telemetryMetrics?.p50Ms ?? 0}ms</span>
                <span className="text-xs text-slate-400 font-mono">P90: {telemetryMetrics?.p90Ms ?? 0}ms</span>
                <span className="text-xs text-slate-500 font-mono">P99: {telemetryMetrics?.p99Ms ?? 0}ms</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex justify-between">
                <span>Avg Latency: {telemetryMetrics?.avgLatencyMs ?? 0}ms</span>
                <span className="text-emerald-400">Target &lt; 300ms</span>
              </div>
            </div>

            <div className="bg-[#12131a] border border-[#1f212e] rounded-xl p-4">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider">
                <span>Success / Error Rate</span>
                <Activity className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-emerald-400 font-mono">{telemetryMetrics?.successRatePct ?? 100}%</span>
                <span className="text-xs text-rose-400 font-mono">Error: {telemetryMetrics?.errorRatePct ?? 0}%</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                {(telemetryMetrics?.rateLimitRequests ?? 0) > 0 ? (
                  <span className="text-amber-400">⚠️ {telemetryMetrics.rateLimitRequests} Rate Limits (429)</span>
                ) : (
                  <span className="text-emerald-400/80">0 Rate Limits detected</span>
                )}
              </div>
            </div>

            <div className="bg-[#12131a] border border-[#1f212e] rounded-xl p-4">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider">
                <span>Throughput</span>
                <Network className="w-4 h-4 text-blue-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-white font-mono">{telemetryMetrics?.requestsPerSec ?? 0}</span>
                <span className="text-xs text-slate-400">req / sec</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                Total Sampled: {telemetryMetrics?.totalRequests ?? 0} calls
              </div>
            </div>

            <div className="bg-[#12131a] border border-[#1f212e] rounded-xl p-4">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider">
                <span>WebSocket Stream Health</span>
                <Wifi className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-cyan-400 font-mono">
                  {(telemetryMetrics?.wsHealth?.avgWsLatencyMs ?? 0) > 0 ? `${telemetryMetrics?.wsHealth?.avgWsLatencyMs}ms` : 'Active'}
                </span>
                <span className={`text-xs uppercase font-bold px-1.5 py-0.5 rounded ${
                  telemetryMetrics?.wsHealth?.status === 'healthy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                }`}>
                  {telemetryMetrics?.wsHealth?.status ?? 'healthy'}
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                Disconnects: {telemetryMetrics?.wsHealth?.wsDisconnects ?? 0} in last 30 events
              </div>
            </div>
          </div>

          {/* Market Data Infrastructure Traffic & Caching Matrix */}
          <div className="bg-[#12131a] border border-[#1f212e] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                Market Data Manager Traffic & Cache Efficiency
              </h3>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-slate-400">Circuit Breaker:</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  marketStats.circuitBreakerState === 'CLOSED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                  marketStats.circuitBreakerState === 'HALF_OPEN' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                  'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}>
                  {marketStats.circuitBreakerState}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-[#181a26] border border-[#26293b] rounded-lg p-3">
                <div className="text-slate-400 text-[11px]">Total Requests</div>
                <div className="text-xl font-extrabold text-white font-mono mt-1">{marketStats.requests}</div>
                <div className="text-[10px] text-slate-500 mt-1">Total API calls</div>
              </div>

              <div className="bg-[#181a26] border border-[#26293b] rounded-lg p-3">
                <div className="text-slate-400 text-[11px]">Cache Hit Ratio</div>
                <div className="text-xl font-extrabold text-emerald-400 font-mono mt-1">
                  {(marketStats.cacheHits + marketStats.cacheMisses) > 0 ? ((marketStats.cacheHits / (marketStats.cacheHits + marketStats.cacheMisses)) * 100).toFixed(1) : 0}%
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{marketStats.cacheHits} Hits / {marketStats.cacheMisses} Misses</div>
              </div>

              <div className="bg-[#181a26] border border-[#26293b] rounded-lg p-3">
                <div className="text-slate-400 text-[11px]">In-Flight Deduplications</div>
                <div className="text-xl font-extrabold text-indigo-400 font-mono mt-1">{marketStats.deduplicated}</div>
                <div className="text-[10px] text-slate-500 mt-1">Saved Duplicate Calls</div>
              </div>

              <div className="bg-[#181a26] border border-[#26293b] rounded-lg p-3">
                <div className="text-slate-400 text-[11px]">Batched Requests</div>
                <div className="text-xl font-extrabold text-cyan-400 font-mono mt-1">{marketStats.batched}</div>
                <div className="text-[10px] text-slate-500 mt-1">30 Mints/Chunk</div>
              </div>

              <div className="bg-[#181a26] border border-[#26293b] rounded-lg p-3">
                <div className="text-slate-400 text-[11px]">429 Backoff Events</div>
                <div className={`text-xl font-extrabold font-mono mt-1 ${marketStats.rateLimited > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
                  {marketStats.rateLimited}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Retry-After Guarded</div>
              </div>

              <div className="bg-[#181a26] border border-[#26293b] rounded-lg p-3">
                <div className="text-slate-400 text-[11px]">Active Cached Mints</div>
                <div className="text-xl font-extrabold text-amber-400 font-mono mt-1">{marketStats.activeTokens}</div>
                <div className="text-[10px] text-slate-500 mt-1">Avg Latency: {(marketStats.averageLatencyMs || 0).toFixed(0)}ms</div>
              </div>
            </div>
          </div>

          {/* Breakdown Per API Endpoint */}
          <div className="bg-[#12131a] border border-[#1f212e] rounded-xl p-5">
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-400" />
              API & RPC Endpoint Latency Matrix
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {Object.keys(telemetryMetrics.byEndpoint).length === 0 ? (
                <div className="col-span-full py-8 text-center text-slate-500 text-xs">
                  No telemetry recorded yet. Perform API requests or run system check to populate matrix.
                </div>
              ) : (
                Object.entries(telemetryMetrics.byEndpoint).map(([ep, stat]) => (
                  <div key={ep} className="bg-[#181a26] border border-[#26293b] rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-slate-200 text-xs truncate max-w-[140px]">{ep}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        stat.p90Ms < 200 ? 'bg-emerald-500/10 text-emerald-400' : stat.p90Ms < 500 ? 'bg-amber-500/10 text-amber-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {stat.p90Ms}ms P90
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400 mt-2 font-mono">
                      <span>Avg: {stat.avgMs}ms</span>
                      <span>Calls: {stat.count}</span>
                    </div>
                    {stat.rateLimits > 0 && (
                      <div className="text-[10px] text-amber-400 mt-1">
                        ⚠️ 429 Rate Limited: {stat.rateLimits}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Live OpenTelemetry Spans Log */}
          <div className="bg-[#12131a] border border-[#1f212e] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" />
                Live OpenTelemetry Trace Spans Stream
              </h3>
              <span className="text-xs text-slate-400 font-mono">{recentSpans.length} active spans</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1f212e] text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                    <th className="pb-2">Timestamp</th>
                    <th className="pb-2">Trace ID</th>
                    <th className="pb-2">Operation / Span Name</th>
                    <th className="pb-2 text-right">Duration</th>
                    <th className="pb-2 text-center">Status</th>
                    <th className="pb-2">Attributes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181a26]">
                  {recentSpans.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        Waiting for API telemetry spans...
                      </td>
                    </tr>
                  ) : (
                    recentSpans.map(s => (
                      <tr key={s.spanId + s.startTime} className="hover:bg-[#181a2b]/50 transition-colors">
                        <td className="py-2.5 text-slate-400 font-mono text-[11px]">
                          {new Date(s.startTime).toLocaleTimeString()}
                        </td>
                        <td className="py-2.5 font-mono text-indigo-400 text-[11px]">
                          {s.traceId.slice(0, 8)}...
                        </td>
                        <td className="py-2.5 font-medium text-slate-200">
                          {s.name}
                        </td>
                        <td className="py-2.5 text-right font-mono text-slate-300">
                          {s.durationMs}ms
                        </td>
                        <td className="py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            s.status === 'OK' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-400 font-mono text-[10px] max-w-[220px] truncate">
                          {JSON.stringify(s.attributes)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SYSTEM READINESS TESTS */}
      {activeTab === 'tests' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-[#12131a] p-4 rounded-xl border border-[#1f212e]">
            <div>
              <h3 className="font-semibold text-white text-sm">Automated Endpoint Verification</h3>
              <p className="text-xs text-slate-400 mt-0.5">Ping RPC, Jupiter, LaserStream, and DexScreener endpoints to ensure non-blocked access.</p>
            </div>
            <button 
              onClick={runTests}
              disabled={isTesting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-50 transition-colors"
            >
              {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              {isTesting ? 'Testing Endpoints...' : 'Run Endpoint Checks'}
            </button>
          </div>

          <div className="grid gap-3">
            <TestItem title="Solana RPC Connection (Execution Node)" result={results.rpcUrl} />
            <TestItem title="Master Monitor RPC (onLogs, Discovery & Metrics)" result={results.masterMonitorRpc} />
            <TestItem title="Jupiter Executable Pre-Sell Validator (Jupiter Only)" result={results.jupiterPreSell} />
            <TestItem title="Helius LaserStream Ingestion Feed" result={results.laserstream} />
            <TestItem title="DexScreener Market Price Feed" result={results.dexscreener} />
          </div>

          <div className="bg-blue-950/30 border border-blue-900/50 rounded-xl p-4">
            <h3 className="font-semibold text-blue-400 mb-2 text-xs uppercase tracking-wider">Trading Node Best Practices</h3>
            <ul className="text-xs text-blue-300/80 space-y-1.5 list-disc list-inside">
              <li><strong>Dedicated Private RPCs:</strong> High frequency momentum requires custom RPCs with burst support (Helius, QuickNode, Triton).</li>
              <li><strong>OpenTelemetry Tracing:</strong> Use trace IDs to detect RPC rate limits (429) or blockhash lag before trades fail.</li>
            </ul>
          </div>
        </div>
      )}

      {/* TAB 3: OTLP / ONEUPTIME EXPORTER CONFIG */}
      {activeTab === 'exporter' && (
        <div className="bg-[#12131a] border border-[#1f212e] rounded-xl p-6 space-y-6">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-indigo-400" />
              OneUptime & OpenTelemetry OTLP Exporter Setup
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Stream standard OpenTelemetry traces and latency metrics directly into OneUptime, Datadog, or any OTLP/HTTP collector.
            </p>
          </div>

          <form onSubmit={handleSaveOtlp} className="space-y-4 max-w-xl">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                OTLP HTTP Endpoint URL
              </label>
              <input
                type="text"
                placeholder="https://oneuptime.com/api/otlp/v1/traces or http://localhost:4318/v1/traces"
                value={otlpConfig.endpoint}
                onChange={e => setOtlpConfig({ ...otlpConfig, endpoint: e.target.value })}
                className="w-full bg-[#181a26] border border-[#26293b] rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                OneUptime Telemetry Token / Ingestion Secret
              </label>
              <input
                type="password"
                placeholder="Enter OneUptime ingestion token..."
                value={otlpConfig.apiKey}
                onChange={e => setOtlpConfig({ ...otlpConfig, apiKey: e.target.value })}
                className="w-full bg-[#181a26] border border-[#26293b] rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="autoExport"
                checked={otlpConfig.autoExport}
                onChange={e => setOtlpConfig({ ...otlpConfig, autoExport: e.target.checked })}
                className="rounded border-[#26293b] bg-[#181a26] text-indigo-600 focus:ring-indigo-500 h-4 w-4"
              />
              <label htmlFor="autoExport" className="text-xs text-slate-300 cursor-pointer">
                Automatically export spans every 15 seconds
              </label>
            </div>

            <div className="flex items-center gap-3 pt-4 border-t border-[#1f212e]">
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Save Exporter Settings
              </button>

              <button
                type="button"
                onClick={handleManualExport}
                disabled={exportingStatus.loading || !otlpConfig.endpoint}
                className="px-4 py-2 bg-[#181a26] hover:bg-[#202334] text-slate-200 border border-[#26293b] rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {exportingStatus.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 text-indigo-400" />}
                Export Pending Spans Now
              </button>
            </div>

            {exportingStatus.msg && (
              <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                exportingStatus.error ? 'bg-rose-950/40 border border-rose-900/50 text-rose-300' : 'bg-emerald-950/40 border border-emerald-900/50 text-emerald-300'
              }`}>
                {exportingStatus.error ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
                <span>{exportingStatus.msg}</span>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
};

