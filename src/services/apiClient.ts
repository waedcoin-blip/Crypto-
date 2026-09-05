// src/services/apiClient.ts
import { auth } from '../lib/firebase';

export interface ApiClientOptions extends RequestInit {
  skipAuth?: boolean;
}

class ApiClient {
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
        // Return synthetic 401 Response early if unauthenticated for protected endpoint
        return new Response(JSON.stringify({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    let response = await fetch(url, { ...restOptions, headers });

    // Handle 401 token refresh once
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

  public async get<T = any>(url: string, options: ApiClientOptions = {}): Promise<T> {
    const res = await this.fetch(url, { ...options, method: 'GET' });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
    }
    return res.json();
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
    return res.json();
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
    return res.json();
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
    return res.json();
  }
}

export const apiClient = new ApiClient();
