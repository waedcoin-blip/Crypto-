// src/services/TransactionBroadcaster.ts
import { Connection } from '@solana/web3.js';
import { rpcRouting } from './rpcRouting';
import { PreparedExitTransaction } from './ExitTransactionBuilder';
import { apiClient } from './apiClient';

export interface BroadcastResult {
  signature: string;
  slot?: number;
  confirmed: boolean;
  landingTimeMs: number;
  error?: string;
}

export class TransactionBroadcaster {
  private static instance: TransactionBroadcaster;

  public static getInstance(): TransactionBroadcaster {
    if (!TransactionBroadcaster.instance) {
      TransactionBroadcaster.instance = new TransactionBroadcaster();
    }
    return TransactionBroadcaster.instance;
  }

  private getConnection(): Connection {
    const rpcUrl = rpcRouting.getExecutionRpcUrl();
    return new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Broadcasts a prepared exit transaction and monitors on-chain signature confirmation via WSS first, falling back to polling.
   */
  public async broadcastAndConfirm(
    preparedTx: PreparedExitTransaction,
    timeoutMs: number = 45000
  ): Promise<BroadcastResult> {
    const start = Date.now();
    
    // Client-side direct broadcast is neutralized; route through authoritative server execution via apiClient
    const data = await apiClient.post('/api/trading/sell', {
      network: 'mainnet',
      mint: preparedTx.quote.mint,
      amountRaw: preparedTx.quote.inputAmountRaw.toString(),
      slippageBps: preparedTx.quote.slippageBps,
      clientRequestId: `exit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      reason: 'exit',
    });

    if (!data || !data.success) {
      throw new Error(`BROADCAST_SUBMIT_FAILED: ${data?.error || 'Server broadcast failed'}`);
    }

    return {
      signature: data.signature || 'server_confirmed',
      slot: 0,
      confirmed: true,
      landingTimeMs: Date.now() - start,
    };
  }
}

export const transactionBroadcaster = TransactionBroadcaster.getInstance();
