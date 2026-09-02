import { Connection } from '@solana/web3.js';
import { rpcRouting, RpcRole } from '../../services/rpcRouting';
import { rpcHealthManager } from '../../services/rpcHealthManager';
import { loggerService } from '../logging/LoggerService';

export class ConnectionFactory {
  private static connections = new Map<string, Connection>();

  public static getConnectionForRole(role: RpcRole, commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Connection {
    let url: string;
    switch (role) {
      case 'search':
        url = rpcRouting.getSearchRpcUrl();
        break;
      case 'monitor':
        url = rpcRouting.getMonitorRpcUrl();
        break;
      case 'execution':
        url = rpcRouting.getExecutionRpcUrl();
        break;
      default:
        url = rpcHealthManager.getActiveEndpoint();
    }

    const key = `${role}:${url}:${commitment}`;
    if (!this.connections.has(key)) {
      const conn = new Connection(url, { commitment, wsEndpoint: rpcRouting.getWsEndpoints(role)[0] });
      this.connections.set(key, conn);
      loggerService.emit('RPC_FAILOVER', `Created connection for role: ${role}`, { metadata: { url, commitment } });
    }

    return this.connections.get(key)!;
  }

  public static getWsUrlForRole(role: RpcRole): string {
    const endpoints = rpcRouting.getWsEndpoints(role);
    if (endpoints.length > 0) return endpoints[0];
    throw new Error(`WS_UNAVAILABLE_FOR_ROLE_${role.toUpperCase()}`);
  }
}
