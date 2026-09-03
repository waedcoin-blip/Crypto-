// src/services/TransactionBroadcaster.ts
import { Connection } from '@solana/web3.js';
import { rpcRouting } from './rpcRouting';
import { PreparedExitTransaction } from './ExitTransactionBuilder';

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
    const connection = this.getConnection();

    let signature: string;
    try {
      signature = await connection.sendRawTransaction(preparedTx.rawTxBuffer, {
        skipPreflight: false,
        maxRetries: 3,
      });
    } catch (err: any) {
      throw new Error(`BROADCAST_SUBMIT_FAILED: ${err?.message || String(err)}`);
    }

    let isConfirmed = false;
    let landingSlot: number | undefined;
    let confirmationError: string | undefined;

    // 1. WSS Signature Listener (Fast Path)
    const wssPromise = new Promise<{ slot?: number; err?: any }>((resolve) => {
      let subId: number | null = null;
      try {
        subId = connection.onSignature(
          signature,
          (result, context) => {
            if (subId !== null) {
              try {
                connection.removeSignatureListener(subId);
              } catch (_) {}
            }
            resolve({ slot: context.slot, err: result.err });
          },
          'confirmed'
        );
      } catch (err) {
        // WSS listener registration failed, fallback promise will resolve
      }
    });

    // 2. RPC Polling Fallback (Watchdog)
    const pollingPromise = (async () => {
      const deadline = start + timeoutMs;
      while (Date.now() < deadline && !isConfirmed) {
        try {
          const status = await connection.getSignatureStatus(signature, {
            searchTransactionHistory: true,
          });
          const val = status.value;
          if (val) {
            if (val.err) {
              return { slot: val.slot, err: val.err };
            }
            if (val.confirmationStatus === 'confirmed' || val.confirmationStatus === 'finalized') {
              return { slot: val.slot, err: null };
            }
          }
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 600));
      }
      return { err: 'TIMEOUT' };
    })();

    // Race WSS vs Polling
    const winner = await Promise.race([wssPromise, pollingPromise]);

    if (winner.err && winner.err !== 'TIMEOUT') {
      confirmationError = typeof winner.err === 'object' ? JSON.stringify(winner.err) : String(winner.err);
      throw new Error(`TRANSACTION_ON_CHAIN_FAILED: Signature ${signature} failed on-chain: ${confirmationError}`);
    } else if (winner.err === 'TIMEOUT') {
      throw new Error(`TRANSACTION_CONFIRMATION_TIMEOUT: Signature ${signature} was not confirmed within ${timeoutMs}ms.`);
    } else {
      isConfirmed = true;
      landingSlot = winner.slot;
    }

    const landingTimeMs = Date.now() - start;

    return {
      signature,
      slot: landingSlot,
      confirmed: isConfirmed,
      landingTimeMs,
      error: confirmationError,
    };
  }
}

export const transactionBroadcaster = TransactionBroadcaster.getInstance();
