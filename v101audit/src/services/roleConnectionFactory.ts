import { Connection, ConnectionConfig } from '@solana/web3.js';
import { rpcRouting, RpcRole } from './rpcRouting';

const DEFAULT_CONFIG: ConnectionConfig = { commitment: 'confirmed' };

/**
 * Creates a Solana connection bound to one explicit application role.
 * Callers must never silently substitute another role when an endpoint fails.
 */
export function createRoleConnection(role: RpcRole, config: ConnectionConfig = DEFAULT_CONFIG): Connection {
  const rpcUrl = rpcRouting.getPrimaryRpc(role);
  const wsEndpoints = rpcRouting.getWsEndpoints(role);
  return new Connection(rpcUrl, {
    ...DEFAULT_CONFIG,
    ...config,
    wsEndpoint: config.wsEndpoint || wsEndpoints[0],
  });
}

export function getRoleRpcUrls(role: RpcRole): string[] {
  return rpcRouting.getRpcEndpoints(role);
}
