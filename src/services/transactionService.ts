// src/services/transactionService.ts
// Unified Transaction Service for ARINA X-RAY
// Manages transaction building, signing, sending, retry loops, and confirmation polling.

import { VersionedTransaction, Keypair, Connection } from '@solana/web3.js';
import { rpcService } from './rpcService';

export interface SendTransactionOptions {
  skipPreflight?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface TransactionSendResult {
  signature: string;
  confirmed: boolean;
  slot?: number;
  error?: string;
}

class TransactionService {
  /**
   * Signs and sends a VersionedTransaction using a Keypair signer and polls for confirmation.
   */
  public async sendAndConfirmTransaction(
    transaction: VersionedTransaction,
    signer: Keypair,
    options: SendTransactionOptions = {}
  ): Promise<TransactionSendResult> {
    const { skipPreflight = true, maxRetries = 3, timeoutMs = 90_000 } = options;

    try {
      // 1. Sign transaction
      transaction.sign([signer]);

      // 2. Serialize raw bytes
      const rawTx = transaction.serialize();

      // 3. Send raw transaction via RPC service
      const signature = await rpcService.sendRawTransaction(rawTx, 'execution');

      // 4. Poll signature status until confirmed or timed out
      const pollResult = await rpcService.pollSignatureStatus(signature, timeoutMs, 'execution');

      return {
        signature,
        confirmed: pollResult.confirmed,
        slot: pollResult.slot,
        error: pollResult.confirmed ? undefined : String(pollResult.err || 'UNCONFIRMED'),
      };
    } catch (err: any) {
      return {
        signature: '',
        confirmed: false,
        error: err?.message || String(err),
      };
    }
  }
}

export const transactionService = new TransactionService();
