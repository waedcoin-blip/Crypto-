// src/services/ApiClient.ts
import { auth } from '../lib/firebase';

export interface ApiClientOptions extends RequestInit {
  skipAuth?: boolean;
}

export class ApiClient {
  private isRefreshingToken = false;

  public async getIdToken(forceRefresh = false): Promise<string | null> {
    const user = auth.currentUser;
    if (!user) return null;
    try {
      return await user.getIdToken(forceRefresh);
    } catch (err) {
      console.warn('[ApiClient] Failed to get Firebase ID token:', err);
      return null;
    }
  }

  public async fetch(url: string, options: ApiClientOptions = {}): Promise<Response> {
    const { skipAuth, headers: customHeaders, ...restOptions } = options;
    const headers = new Headers(customHeaders || {});

    if (!skipAuth) {
      const token = await this.getIdToken(false);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      } else {
        return new Response(JSON.stringify({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    let response = await fetch(url, { ...restOptions, headers });

    if (response.status === 401 && !skipAuth && !this.isRefreshingToken) {
      this.isRefreshingToken = true;
      try {
        const freshToken = await this.getIdToken(true);
        if (freshToken) {
          headers.set('Authorization', `Bearer ${freshToken}`);
          response = await fetch(url, { ...restOptions, headers });
        }
      } catch (e) {
        console.warn('[ApiClient] Token refresh retry failed:', e);
      } finally {
        this.isRefreshingToken = false;
      }
    }

    return response;
  }

  private async safeJson(res: Response): Promise<any> {
    const text = await res.text().catch(() => '');
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text, status: res.status, ok: res.ok };
    }
  }

  public async get<T = any>(url: string, options: ApiClientOptions = {}): Promise<T> {
    const res = await this.fetch(url, { ...options, method: 'GET' });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
    }
    return this.safeJson(res);
  }

  public async post<T = any>(url: string, body?: any, options: ApiClientOptions = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    if (body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await this.fetch(url, {
      ...options,
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
    }
    return this.safeJson(res);
  }

  public async patch<T = any>(url: string, body?: any, options: ApiClientOptions = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    if (body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await this.fetch(url, {
      ...options,
      method: 'PATCH',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
    }
    return this.safeJson(res);
  }

  public async put<T = any>(url: string, body?: any, options: ApiClientOptions = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    if (body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await this.fetch(url, {
      ...options,
      method: 'PUT',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
    }
    return this.safeJson(res);
  }
}

export const apiClient = new ApiClient();

export const tradingApi = {
  getEngineStatus: () => apiClient.get('/api/trading/engine/status', { skipAuth: true }),
  getStatus: () => apiClient.get('/api/trading/engine/status', { skipAuth: true }),
  getPositions: (network?: string, wallet?: string) => {
    const params = new URLSearchParams();
    if (network) params.append('network', network);
    if (wallet) params.append('wallet', wallet);
    const qs = params.toString();
    return apiClient.get(`/api/trading/positions${qs ? `?${qs}` : ''}`, { skipAuth: true });
  },
  getPortfolioPnL: () => apiClient.get('/api/trading/portfolio/pnl', { skipAuth: true }),
  buy: (payload: any) => apiClient.post('/api/trading/buy', payload, { skipAuth: true }),
  sell: (payload: any) => apiClient.post('/api/trading/sell', payload, { skipAuth: true }),
  getRebuyGuardState: (mint: string, network?: string, wallet?: string) => {
    const params = new URLSearchParams();
    if (network) params.append('network', network);
    if (wallet) params.append('wallet', wallet);
    const qs = params.toString();
    return apiClient.get(`/api/trading/rebuy-guard/${mint}${qs ? `?${qs}` : ''}`, { skipAuth: true });
  },
  refreshValuations: () => apiClient.post('/api/trading/valuations/refresh', {}, { skipAuth: true }),
  getSupervisorStatus: () => apiClient.get('/api/trading/supervisor/status', { skipAuth: true }),
  startSupervisor: (params?: any) => apiClient.post('/api/trading/supervisor/start', params, { skipAuth: true }),
  stopSupervisor: () => apiClient.post('/api/trading/supervisor/stop', {}, { skipAuth: true }),
  forceRecovery: (reason?: string) => apiClient.post('/api/trading/supervisor/recovery', { reason }, { skipAuth: true }),
};

export const criteriaApi = {
  get: () => apiClient.get('/api/criteria', { skipAuth: true }),
  update: (patch: any) => apiClient.put('/api/criteria', patch, { skipAuth: true }),
  reset: () => apiClient.post('/api/criteria/reset', {}, { skipAuth: true }),
  getPresets: () => apiClient.get('/api/criteria/presets', { skipAuth: true }),
  applyPreset: (name: string) => apiClient.post(`/api/criteria/presets/${encodeURIComponent(name)}`, {}, { skipAuth: true }),
};

export const healthApi = {
  get: () => apiClient.get('/api/health', { skipAuth: true }),
};

export const pipelineApi = {
  getCandidates: () => apiClient.get('/api/pipeline/candidates', { skipAuth: true }),
  validateToken: (telemetry: any) => apiClient.post('/api/pipeline/validate', telemetry, { skipAuth: true }),
  ingress: (event: any) => apiClient.post('/api/pipeline/ingress', event, { skipAuth: true }),
};
