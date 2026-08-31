// src/services/rpcRouting.ts

export type RpcRole = 'execution' | 'monitor' | 'search';

export interface RpcRoleConfig {
  searchRpcUrl: string;
  executionRpcUrl: string;
  monitorRpcUrl: string;
}

class RpcRouting {
  private searchRpcUrl: string = '';
  private executionRpcUrl: string = '';
  private monitorRpcUrl: string = '';

  constructor() {
    this.reload();
  }

  public reload(): void {
    const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
    this.searchRpcUrl =
      env.SEARCH_RPC_URL?.trim() ||
      (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SEARCH_RPC?.trim() : '') ||
      '';

    this.executionRpcUrl =
      env.EXECUTION_RPC_URL?.trim() ||
      (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_EXECUTION_RPC?.trim() : '') ||
      '';

    this.monitorRpcUrl =
      env.MONITOR_RPC_URL?.trim() ||
      (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_MONITOR_RPC?.trim() : '') ||
      '';
  }

  public getSearchRpcUrl(): string {
    if (!this.searchRpcUrl) {
      throw new Error('SEARCH_RPC_UNAVAILABLE');
    }

    return this.searchRpcUrl;
  }

  public getExecutionRpcUrl(): string {
    if (!this.executionRpcUrl) {
      throw new Error('EXECUTION_RPC_UNAVAILABLE');
    }

    return this.executionRpcUrl;
  }

  public getMonitorRpcUrl(): string {
    if (!this.monitorRpcUrl) {
      throw new Error('MONITOR_RPC_UNAVAILABLE');
    }

    return this.monitorRpcUrl;
  }

  public getRpcEndpoints(role: RpcRole): string[] {
    try {
      if (role === 'execution') {
        const ep = this.getExecutionRpcUrl();
        return ep ? [ep] : [];
      }
      if (role === 'search') {
        const ep = this.getSearchRpcUrl();
        return ep ? [ep] : [];
      }
      if (role === 'monitor') {
        const ep = this.getMonitorRpcUrl();
        return ep ? [ep] : [];
      }
    } catch {
      return [];
    }
    return [];
  }

  public setRpcRoles(config: Partial<RpcRoleConfig>) {
    if (config.searchRpcUrl !== undefined) {
      this.searchRpcUrl = config.searchRpcUrl.trim();
    }
    if (config.executionRpcUrl !== undefined) {
      this.executionRpcUrl = config.executionRpcUrl.trim();
    }
    if (config.monitorRpcUrl !== undefined) {
      this.monitorRpcUrl = config.monitorRpcUrl.trim();
    }
  }
}

export const rpcRouting = new RpcRouting();

export function getRpcEndpoints(role: RpcRole): string[] {
  return rpcRouting.getRpcEndpoints(role);
}

export function getPrimaryRpc(role: RpcRole): string {
  const endpoint = getRpcEndpoints(role)[0];

  if (!endpoint) {
    throw new Error(`${role.toUpperCase()}_RPC_UNAVAILABLE`);
  }

  return endpoint;
}


