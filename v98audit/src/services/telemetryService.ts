/**
 * OpenTelemetry Observability Engine for Cryptocurrency Exchange & RPC APIs
 * Implements OpenTelemetry traces, latency metrics (P50/P90/P99), HTTP status tracking,
 * WebSocket stream health monitoring, and OTLP / OneUptime exporter integration.
 */

export interface SpanAttributeValue {
  [key: string]: string | number | boolean | undefined;
}

export interface TelemetrySpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: 'OK' | 'ERROR' | 'UNSET';
  statusMessage?: string;
  attributes: SpanAttributeValue;
}

export interface ApiMetricSample {
  timestamp: number;
  endpoint: string;
  operation: string;
  statusCode: number;
  durationMs: number;
  success: boolean;
  errorType?: string;
}

export interface WebSocketStreamMetric {
  timestamp: number;
  feedName: string;
  eventType: 'ping' | 'message' | 'connect' | 'disconnect' | 'error' | 'reconnect';
  latencyMs?: number;
  status: 'healthy' | 'degraded' | 'disconnected';
  details?: string;
}

class TelemetryService {
  private spans: TelemetrySpan[] = [];
  private apiSamples: ApiMetricSample[] = [];
  private wsMetrics: WebSocketStreamMetric[] = [];
  private activeSpans: Map<string, { traceId: string; spanId: string; name: string; startTime: number; attributes: SpanAttributeValue }> = new Map();
  private maxStoredSpans = 200;
  private maxStoredSamples = 1000;
  private listeners: Set<() => void> = new Set();

  // Exporter Config
  private otlpEndpoint = 
    (typeof process !== 'undefined' ? process.env?.OTEL_EXPORTER_OTLP_ENDPOINT || process.env?.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT : undefined) ||
    '';
  private otlpApiKey = 
    (typeof process !== 'undefined' ? process.env?.OTEL_EXPORTER_OTLP_API_KEY || process.env?.OTEL_EXPORTER_OTLP_HEADERS : undefined) ||
    '';
  private autoExportEnabled = !!this.otlpEndpoint;

  constructor() {
    // Periodic auto-prune and auto-export
    setInterval(() => {
      this.pruneOldData();
      if (this.autoExportEnabled && this.otlpEndpoint) {
        this.exportTelemetryToOtlp();
      }
    }, 15000);
  }

  public subscribe(callback: () => void) {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }

  private notify() {
    this.listeners.forEach(cb => {
      try { cb(); } catch (e) { console.error('Telemetry listener error:', e); }
    });
  }

  // ─── UTILITIES ─────────────────────────────────────────────────────────────

  public generateTraceId(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  public generateSpanId(): string {
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  /**
   * Generates a standard W3C traceparent header string:
   * 00-{traceId}-{spanId}-01
   */
  public getTraceParentHeader(traceId?: string, spanId?: string): string {
    const tid = traceId || this.generateTraceId();
    const sid = spanId || this.generateSpanId();
    return `00-${tid}-${sid}-01`;
  }

  // ─── SPAN TRACING ──────────────────────────────────────────────────────────

  public startSpan(name: string, attributes: SpanAttributeValue = {}, parentSpanId?: string): { traceId: string; spanId: string } {
    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();
    const startTime = performance.now();

    const handle = `${traceId}-${spanId}`;
    this.activeSpans.set(handle, {
      traceId,
      spanId,
      name,
      startTime,
      attributes: {
        'service.name': 'crypto-exchange-bot',
        'telemetry.sdk.language': 'typescript',
        'telemetry.sdk.name': 'opentelemetry-custom',
        ...attributes
      }
    });

    return { traceId, spanId };
  }

  public endSpan(
    handle: { traceId: string; spanId: string },
    status: 'OK' | 'ERROR' = 'OK',
    additionalAttributes: SpanAttributeValue = {},
    statusMessage?: string
  ): TelemetrySpan | null {
    const key = `${handle.traceId}-${handle.spanId}`;
    const active = this.activeSpans.get(key);
    if (!active) return null;

    this.activeSpans.delete(key);
    const endTime = performance.now();
    const durationMs = Math.round((endTime - active.startTime) * 100) / 100;

    const span: TelemetrySpan = {
      traceId: active.traceId,
      spanId: active.spanId,
      name: active.name,
      startTime: Date.now() - durationMs,
      endTime: Date.now(),
      durationMs,
      status,
      statusMessage,
      attributes: {
        ...active.attributes,
        ...additionalAttributes,
        'duration.ms': durationMs
      }
    };

    this.spans.unshift(span);
    if (this.spans.length > this.maxStoredSpans) {
      this.spans = this.spans.slice(0, this.maxStoredSpans);
    }

    this.notify();
    return span;
  }

  // ─── API METRICS ───────────────────────────────────────────────────────────

  public recordApiRequest(
    endpoint: string,
    operation: string,
    statusCode: number,
    durationMs: number,
    errorType?: string,
    traceId?: string
  ) {
    const success = statusCode >= 200 && statusCode < 400;
    const sample: ApiMetricSample = {
      timestamp: Date.now(),
      endpoint: this.normalizeEndpoint(endpoint),
      operation,
      statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      success,
      errorType
    };

    this.apiSamples.push(sample);
    if (this.apiSamples.length > this.maxStoredSamples) {
      this.apiSamples.shift();
    }

    // Also auto-record a span if none was active
    if (!traceId) {
      const { traceId: tId, spanId: sId } = this.startSpan(`http.${operation.toLowerCase()}`, {
        'http.status_code': statusCode,
        'http.url': endpoint,
        'peer.service': this.normalizeEndpoint(endpoint),
        ...(errorType ? { 'error.type': errorType } : {})
      });
      this.endSpan({ traceId: tId, spanId: sId }, success ? 'OK' : 'ERROR', {
        'http.status_code': statusCode
      }, errorType);
    } else {
      this.notify();
    }
  }

  public recordWebSocketMetric(
    feedName: string,
    eventType: 'ping' | 'message' | 'connect' | 'disconnect' | 'error' | 'reconnect',
    latencyMs?: number,
    status: 'healthy' | 'degraded' | 'disconnected' = 'healthy',
    details?: string
  ) {
    this.wsMetrics.unshift({
      timestamp: Date.now(),
      feedName,
      eventType,
      latencyMs,
      status,
      details
    });

    if (this.wsMetrics.length > 200) {
      this.wsMetrics = this.wsMetrics.slice(0, 200);
    }
    this.notify();
  }

  private normalizeEndpoint(rawUrl: string): string {
    if (!rawUrl) return 'Unknown API';
    if (rawUrl.includes('jup') || rawUrl.includes('jupiter')) return 'Jupiter API';
    if (rawUrl.includes('helius') || rawUrl.includes('solana') || rawUrl.includes('rpc')) return 'Solana RPC Node';
    if (rawUrl.includes('dexscreener')) return 'DexScreener API';
    if (rawUrl.includes('jito') || rawUrl.includes('block-engine')) return 'Jito Engine';
    if (rawUrl.includes('laserstream')) return 'LaserStream Feed';
    if (rawUrl.includes('pump.fun')) return 'Pump.fun API';
    return rawUrl.split('?')[0].slice(0, 40);
  }

  private pruneOldData() {
    const cutoff = Date.now() - 3600000; // 1 hour history
    this.apiSamples = this.apiSamples.filter(s => s.timestamp >= cutoff);
    this.wsMetrics = this.wsMetrics.filter(m => m.timestamp >= cutoff);
  }

  // ─── METRIC COMPUTATIONS (PERCENTILES, ERROR RATES) ──────────────────────

  public getMetricsSummary() {
    const now = Date.now();
    const last5mCutoff = now - 300000;
    const samples = this.apiSamples.filter(s => s.timestamp >= last5mCutoff);

    const totalRequests = samples.length;
    const successfulRequests = samples.filter(s => s.success).length;
    const errorRequests = samples.filter(s => !s.success).length;
    const rateLimitRequests = samples.filter(s => s.statusCode === 429).length;

    const errorRatePct = totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0;
    const successRatePct = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;

    // Latencies sorted
    const latencies = samples.map(s => s.durationMs).sort((a, b) => a - b);
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const p50 = this.getPercentile(latencies, 50);
    const p90 = this.getPercentile(latencies, 90);
    const p99 = this.getPercentile(latencies, 99);

    // Grouping by Endpoint
    const byEndpoint: Record<string, { count: number; errors: number; avgMs: number; p90Ms: number; rateLimits: number }> = {};
    for (const sample of samples) {
      if (!byEndpoint[sample.endpoint]) {
        byEndpoint[sample.endpoint] = { count: 0, errors: 0, avgMs: 0, p90Ms: 0, rateLimits: 0 };
      }
      const entry = byEndpoint[sample.endpoint];
      entry.count++;
      if (!sample.success) entry.errors++;
      if (sample.statusCode === 429) entry.rateLimits++;
    }

    Object.keys(byEndpoint).forEach(ep => {
      const epSamples = samples.filter(s => s.endpoint === ep).map(s => s.durationMs).sort((a, b) => a - b);
      const epAvg = epSamples.reduce((a, b) => a + b, 0) / (epSamples.length || 1);
      byEndpoint[ep].avgMs = Math.round(epAvg);
      byEndpoint[ep].p90Ms = Math.round(this.getPercentile(epSamples, 90));
    });

    // Grouping by Status Code
    const byStatus: Record<number, number> = {};
    for (const sample of samples) {
      byStatus[sample.statusCode] = (byStatus[sample.statusCode] || 0) + 1;
    }

    // WebSocket Stream Health
    const recentWs = this.wsMetrics.slice(0, 30);
    const wsPingLatencies = recentWs.filter(w => typeof w.latencyMs === 'number').map(w => w.latencyMs!);
    const avgWsLatency = wsPingLatencies.length > 0 ? wsPingLatencies.reduce((a, b) => a + b, 0) / wsPingLatencies.length : 0;
    const wsDisconnects = recentWs.filter(w => w.eventType === 'disconnect' || w.eventType === 'error').length;

    return {
      totalRequests,
      successfulRequests,
      errorRequests,
      rateLimitRequests,
      errorRatePct: Math.round(errorRatePct * 10) / 10,
      successRatePct: Math.round(successRatePct * 10) / 10,
      avgLatencyMs: Math.round(avgLatency),
      p50Ms: Math.round(p50),
      p90Ms: Math.round(p90),
      p99Ms: Math.round(p99),
      requestsPerSec: Math.round((totalRequests / 300) * 100) / 100, // 5 minute window
      byEndpoint,
      byStatus,
      wsHealth: {
        avgWsLatencyMs: Math.round(avgWsLatency),
        wsDisconnects,
        totalWsEvents: recentWs.length,
        status: wsDisconnects > 3 ? 'degraded' : 'healthy'
      }
    };
  }

  private getPercentile(sortedArr: number[], p: number): number {
    if (sortedArr.length === 0) return 0;
    const index = (p / 100) * (sortedArr.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (upper >= sortedArr.length) return sortedArr[sortedArr.length - 1];
    return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
  }

  public getSpans(): TelemetrySpan[] {
    return [...this.spans];
  }

  public getWsMetrics(): WebSocketStreamMetric[] {
    return [...this.wsMetrics];
  }

  // ─── EXPORTER (ONEUPTIME / OTLP HTTP) ──────────────────────────────────────

  public setOtlpConfig(endpoint: string, apiKey: string, autoExport: boolean) {
    this.otlpEndpoint = endpoint;
    this.otlpApiKey = apiKey;
    this.autoExportEnabled = autoExport;

    localStorage.setItem('otel_otlp_endpoint', endpoint);
    localStorage.setItem('otel_otlp_apikey', apiKey);
    localStorage.setItem('otel_auto_export', autoExport ? 'true' : 'false');
    this.notify();
  }

  public getOtlpConfig() {
    return {
      endpoint: this.otlpEndpoint,
      apiKey: this.otlpApiKey,
      autoExport: this.autoExportEnabled
    };
  }

  public async exportTelemetryToOtlp(): Promise<{ success: boolean; exportedSpans: number; error?: string }> {
    if (!this.otlpEndpoint) {
      return { success: false, exportedSpans: 0, error: 'No OTLP Endpoint URL configured' };
    }

    const unexported = this.spans.slice(0, 50);
    if (unexported.length === 0) {
      return { success: true, exportedSpans: 0 };
    }

    const otlpPayload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'crypto-exchange-bot' } },
              { key: 'service.namespace', value: { stringValue: 'trading-engine' } },
              { key: 'telemetry.sdk.language', value: { stringValue: 'typescript' } }
            ]
          },
          scopeSpans: [
            {
              scope: { name: 'exchange-api-tracer', version: '1.0.0' },
              spans: unexported.map(s => ({
                traceId: s.traceId,
                spanId: s.spanId,
                parentSpanId: s.parentSpanId || '',
                name: s.name,
                kind: 3, // CLIENT
                startTimeUnixNano: String(s.startTime * 1_000_000),
                endTimeUnixNano: String(s.endTime * 1_000_000),
                attributes: Object.entries(s.attributes).map(([k, v]) => ({
                  key: k,
                  value: typeof v === 'number'
                    ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v })
                    : typeof v === 'boolean'
                    ? { boolValue: v }
                    : { stringValue: String(v) }
                })),
                status: {
                  code: s.status === 'OK' ? 1 : 2,
                  message: s.statusMessage || ''
                }
              }))
            }
          ]
        }
      ]
    };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (this.otlpApiKey) {
        headers['Authorization'] = `Bearer ${this.otlpApiKey}`;
        headers['X-OneUptime-Token'] = this.otlpApiKey;
      }

      const res = await fetch(this.otlpEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(otlpPayload)
      });

      if (!res.ok) {
        throw new Error(`OTLP export failed HTTP ${res.status}: ${await res.text()}`);
      }

      return { success: true, exportedSpans: unexported.length };
    } catch (e: any) {
      return { success: false, exportedSpans: 0, error: e.message || 'Export failed' };
    }
  }
}

export const telemetryService = new TelemetryService();
