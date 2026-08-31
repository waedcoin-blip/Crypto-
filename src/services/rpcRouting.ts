// src/services/rpcRouting.ts
import { DEFAULT_HELIUS_RPC } from '../constants/solana';

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

  public reload() {
    this.searchRpcUrl =
      localStorage.getItem('juipter_auto_searchRpcUrl') ||
      localStorage.getItem('juipter_auto_rpcUrl') ||
      import.meta.env.VITE_SEARCH_RPC ||
      DEFAULT_HELIUS_RPC;

    this.executionRpcUrl =
      localStorage.getItem('juipter_auto_executionRpcUrl') ||
      localStorage.getItem('juipter_auto_rpcUrl') ||
      import.meta.env.VITE_EXECUTION_RPC ||
      DEFAULT_HELIUS_RPC;

    this.monitorRpcUrl =
      localStorage.getItem('juipter_auto_monitorRpcUrl') ||
      import.meta.env.VITE_MONITOR_RPC ||
      '';
  }

  public getSearchRpcUrl(): string {
    return this.searchRpcUrl || DEFAULT_HELIUS_RPC;
  }

  public getExecutionRpcUrl(): string {
    return this.executionRpcUrl || DEFAULT_HELIUS_RPC;
  }

  /**
   * Monitor RPC URL MUST NOT fall back to execution, search, or paper default RPC.
   * If dedicated monitor RPC is missing, return empty string.
   */
  public getMonitorRpcUrl(): string {
    return this.monitorRpcUrl;
  }

  public getRpcEndpoints(role: RpcRole): string[] {
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
    return [];
  }

  public setRpcRoles(config: Partial<RpcRoleConfig>) {
    if (config.searchRpcUrl !== undefined) {
      this.searchRpcUrl = config.searchRpcUrl.trim();
      localStorage.setItem('juipter_auto_searchRpcUrl', this.searchRpcUrl);
    }
    if (config.executionRpcUrl !== undefined) {
      this.executionRpcUrl = config.executionRpcUrl.trim();
      localStorage.setItem('juipter_auto_executionRpcUrl', this.executionRpcUrl);
    }
    if (config.monitorRpcUrl !== undefined) {
      this.monitorRpcUrl = config.monitorRpcUrl.trim();
      localStorage.setItem('juipter_auto_monitorRpcUrl', this.monitorRpcUrl);
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

