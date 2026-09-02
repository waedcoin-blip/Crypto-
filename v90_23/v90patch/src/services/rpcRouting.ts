// src/services/rpcRouting.ts
// Centralized role-isolated RPC + WebSocket routing.
// Search, Monitor, and Execution each have isolated primary + backup RPC and WS endpoints.
// LaserStream remains an independent gRPC/Geyser ingestion transport.

export type RpcRole = 'execution' | 'monitor' | 'search';

function runtimeEnv(): Record<string, string | undefined> {
  const nodeEnv = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  const viteEnv = (typeof import.meta !== 'undefined' ? import.meta.env : {}) as Record<string, string | undefined>;
  return { ...viteEnv, ...nodeEnv };
}

function normalizeUrl(url: string, protocols: readonly string[], errorCode: string): string {
  const value = url.trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) throw new Error('unsupported protocol');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    throw new Error(errorCode);
  }
}

export function normalizeRpcUrl(url: string): string {
  return normalizeUrl(url, ['https:', 'http:'], 'INVALID_RPC_URL');
}

export function normalizeWsUrl(url: string): string {
  return normalizeUrl(url, ['wss:', 'ws:'], 'INVALID_WS_URL');
}

export function deriveWsUrl(rpcUrl: string): string {
  const parsed = new URL(normalizeRpcUrl(rpcUrl));
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return parsed.toString().replace(/\/$/, '');
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export interface RpcRoleConfig {
  searchRpcUrl: string;
  executionRpcUrl: string;
  monitorRpcUrl: string;
  searchRpcBackupUrl?: string;
  executionRpcBackupUrl?: string;
  monitorRpcBackupUrl?: string;
  searchWsUrl?: string;
  searchWsBackupUrl?: string;
  executionWsUrl?: string;
  executionWsBackupUrl?: string;
  monitorWsUrl?: string;
  monitorWsBackupUrl?: string;
}

type EndpointSet = { rpc: string[]; ws: string[] };

class RpcRouting {
  private endpoints: Record<RpcRole, EndpointSet> = {
    search: { rpc: [], ws: [] },
    monitor: { rpc: [], ws: [] },
    execution: { rpc: [], ws: [] },
  };

  constructor() {
    this.reload();
  }

  public reload(): void {
    const env = runtimeEnv();
    const load = (role: RpcRole) => {
      const prefix = role.toUpperCase();
      const vitePrefix = `VITE_${prefix}`;
      const primaryRpc = env[`${prefix}_RPC_URL`] || env[`${vitePrefix}_RPC`] || '';
      const backupRpc = env[`${prefix}_RPC_BACKUP_URL`] || env[`${vitePrefix}_RPC_BACKUP`] || '';
      const explicitPrimaryWs = env[`${prefix}_WS_URL`] || env[`${vitePrefix}_WS`] || '';
      const explicitBackupWs = env[`${prefix}_WS_BACKUP_URL`] || env[`${vitePrefix}_WS_BACKUP`] || '';

      const rpc = unique([primaryRpc, backupRpc].filter(Boolean).map(normalizeRpcUrl));
      // Every RPC endpoint gets a corresponding WS endpoint. Explicit WS URLs are preferred;
      // otherwise the WS URL is derived from the same provider endpoint.
      const ws = unique([
        explicitPrimaryWs || (primaryRpc ? deriveWsUrl(primaryRpc) : ''),
        explicitBackupWs || (backupRpc ? deriveWsUrl(backupRpc) : ''),
      ].filter(Boolean).map(normalizeWsUrl));
      this.endpoints[role] = { rpc, ws };
    };
    load('search');
    load('monitor');
    load('execution');
  }

  public getSearchRpcUrl(): string {
    return this.getPrimaryRpc('search');
  }

  public getExecutionRpcUrl(): string {
    return this.getPrimaryRpc('execution');
  }

  public getMonitorRpcUrl(): string {
    return this.getPrimaryRpc('monitor');
  }

  public getSearchWsUrl(): string {
    return this.getPrimaryWs('search');
  }

  public getExecutionWsUrl(): string {
    return this.getPrimaryWs('execution');
  }

  public getMonitorWsUrl(): string {
    return this.getPrimaryWs('monitor');
  }

  public getRpcEndpoints(role: RpcRole): string[] {
    return [...this.endpoints[role].rpc];
  }

  public getWsEndpoints(role: RpcRole): string[] {
    return [...this.endpoints[role].ws];
  }

  public getPrimaryRpc(role: RpcRole): string {
    const endpoint = this.endpoints[role].rpc[0];
    if (!endpoint) throw new Error(`${role.toUpperCase()}_RPC_UNAVAILABLE`);
    return endpoint;
  }

  public getPrimaryWs(role: RpcRole): string {
    const endpoint = this.endpoints[role].ws[0];
    if (!endpoint) throw new Error(`${role.toUpperCase()}_WS_UNAVAILABLE`);
    return endpoint;
  }

  public getRoleEndpoints(role: RpcRole): EndpointSet {
    return { rpc: this.getRpcEndpoints(role), ws: this.getWsEndpoints(role) };
  }

  public setRpcRoles(config: Partial<RpcRoleConfig>): void {
    const assign = (
      role: RpcRole,
      rpc: string | undefined,
      rpcBackup: string | undefined,
      ws: string | undefined,
      wsBackup: string | undefined
    ) => {
      const current = this.endpoints[role];
      const nextRpc =
        rpc === undefined && rpcBackup === undefined
          ? current.rpc
          : unique(
              [
                rpc === undefined ? current.rpc[0] : rpc,
                rpcBackup === undefined ? current.rpc[1] : rpcBackup,
              ]
                .filter(Boolean)
                .map(normalizeRpcUrl)
            );

      const primaryWs =
        ws !== undefined
          ? ws
          : nextRpc[0]
          ? deriveWsUrl(nextRpc[0])
          : '';
      const backupWs =
        wsBackup !== undefined
          ? wsBackup
          : nextRpc[1]
          ? deriveWsUrl(nextRpc[1])
          : '';

      const nextWs = unique(
        [primaryWs, backupWs]
          .filter(Boolean)
          .map(normalizeWsUrl)
      );

      this.endpoints[role] = { rpc: nextRpc, ws: nextWs };
    };
    assign('search', config.searchRpcUrl, config.searchRpcBackupUrl, config.searchWsUrl, config.searchWsBackupUrl);
    assign('monitor', config.monitorRpcUrl, config.monitorRpcBackupUrl, config.monitorWsUrl, config.monitorWsBackupUrl);
    assign('execution', config.executionRpcUrl, config.executionRpcBackupUrl, config.executionWsUrl, config.executionWsBackupUrl);
  }
}

export const rpcRouting = new RpcRouting();
export const getRpcEndpoints = (role: RpcRole) => rpcRouting.getRpcEndpoints(role);
export const getWsEndpoints = (role: RpcRole) => rpcRouting.getWsEndpoints(role);
export const getPrimaryRpc = (role: RpcRole) => rpcRouting.getPrimaryRpc(role);
export const getPrimaryWs = (role: RpcRole) => rpcRouting.getPrimaryWs(role);
export const getRoleEndpoints = (role: RpcRole) => rpcRouting.getRoleEndpoints(role);
export const deriveWebSocketUrl = deriveWsUrl;
