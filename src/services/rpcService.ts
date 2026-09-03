// src/services/rpcService.ts
// Unified RPC Service & Connection Pool for ARINA X-RAY
// Manages primary, backup, and fallback Solana RPC connections without recreating Connection instances.

import { Connection, PublicKey, AccountInfo, BlockhashWithExpiryBlockHeight, SignatureStatus, VersionedTransaction } from '@solana/web3.js';
import { rpcRouting, RpcRole, getPrimaryRpc, getRpcEndpoints } from './rpcRouting';
import { DEFAULT_HELIUS_RPC } from '../constants/solana';

class RpcService {
  private connections: Map<string, Connection> = new Map();

  /**
   * Reusable Connection instance getter based on URL.
   */
  public getConnection(endpointUrl?: string): Connection {
    const url = endpointUrl?.trim() || this.getExecutionRpcUrl();
    let conn = this.connections.get(url);
    if (!conn) {
      conn = new Connection(url, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60_000,
      });
      this.connections.set(url, conn);
    }
    return conn;
  }

  public getExecutionRpcUrl(): string {
    try {
      return getPrimaryRpc('execution');
    } catch {
      return DEFAULT_HELIUS_RPC;
    }
  }

  public getMonitorRpcUrl(): string {
    try {
      return getPrimaryRpc('monitor');
    } catch {
      return DEFAULT_HELIUS_RPC;
    }
  }

  public getSearchRpcUrl(): string {
    try {
      return getPrimaryRpc('search');
    } catch {
      return DEFAULT_HELIUS_RPC;
    }
  }

  /**
   * Executes an RPC call with failover retry across backup RPC endpoints.
   */
  private async withFailover<T>(
    role: RpcRole,
    operation: (conn: Connection) => Promise<T>
  ): Promise<T> {
    const endpoints = getRpcEndpoints(role);
    if (endpoints.length === 0) {
      endpoints.push(DEFAULT_HELIUS_RPC);
    }

    let lastError: any = null;
    for (const url of endpoints) {
      try {
        const conn = this.getConnection(url);
        return await operation(conn);
      } catch (err: any) {
        lastError = err;
        console.warn(`[RPC_SERVICE_WARN] Failover for role '${role}' on endpoint ${url}: ${err?.message || err}`);
      }
    }
    throw lastError || new Error(`RPC_FAILOVER_EXHAUSTED: Role '${role}' failed on all endpoints.`);
  }

  /**
   * Get SOL balance in lamports for a given public key.
   */
  public async getBalance(pubkey: PublicKey | string, role: RpcRole = 'execution'): Promise<number> {
    const key = typeof pubkey === 'string' ? new PublicKey(pubkey) : pubkey;
    return this.withFailover(role, (conn) => conn.getBalance(key, 'confirmed'));
  }

  /**
   * Get Account Info for a given public key.
   */
  public async getAccountInfo(pubkey: PublicKey | string, role: RpcRole = 'execution'): Promise<AccountInfo<Buffer> | null> {
    const key = typeof pubkey === 'string' ? new PublicKey(pubkey) : pubkey;
    return this.withFailover(role, (conn) => conn.getAccountInfo(key, 'confirmed'));
  }

  /**
   * Get recent blockhash with fallback.
   */
  public async getLatestBlockhash(role: RpcRole = 'execution'): Promise<BlockhashWithExpiryBlockHeight> {
    return this.withFailover(role, (conn) => conn.getLatestBlockhash('confirmed'));
  }

  /**
   * Get signature status for polling transaction confirmations on-chain.
   */
  public async getSignatureStatus(
    signature: string,
    role: RpcRole = 'execution'
  ): Promise<SignatureStatus | null> {
    return this.withFailover(role, async (conn) => {
      const resp = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
      return resp.value;
    });
  }

  /**
   * Sends a raw versioned or legacy transaction to the network.
   */
  public async sendRawTransaction(
    rawTransaction: Buffer | Uint8Array,
    role: RpcRole = 'execution'
  ): Promise<string> {
    return this.withFailover(role, (conn) =>
      conn.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 3,
        preflightCommitment: 'confirmed',
      })
    );
  }

  /**
   * Polls a signature until confirmed or max timeout is reached.
   */
  public async pollSignatureStatus(
    signature: string,
    timeoutMs: number = 90_000,
    role: RpcRole = 'execution'
  ): Promise<{ confirmed: boolean; slot?: number; err?: any }> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await this.getSignatureStatus(signature, role);
        if (status) {
          if (status.err) {
            return { confirmed: false, err: status.err };
          }
          if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
            return { confirmed: true, slot: status.slot };
          }
        }
      } catch (e) {
        // Suppress transient poll error and retry
      }
      await new Promise((res) => setTimeout(res, 2000));
    }
    return { confirmed: false, err: 'TIMEOUT' };
  }
}

export const rpcService = new RpcService();
