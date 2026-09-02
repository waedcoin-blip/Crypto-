import { parseWalletTransaction, ParsedWalletTrade } from '../../services/WalletTransactionParser';
import { ConnectionFactory } from '../../infrastructure/solana/ConnectionFactory';
import { transactionRepository } from '../../infrastructure/persistence/TransactionRepository';
import { loggerService } from '../../infrastructure/logging/LoggerService';

export class WalletTransactionProcessor {
  private processedSignatures: Set<string> = new Set();
  private maxSignatures = 10000;

  public isSignatureProcessed(signature: string): boolean {
    return this.processedSignatures.has(signature);
  }

  public recordSignature(signature: string): void {
    this.processedSignatures.add(signature);
    if (this.processedSignatures.size > this.maxSignatures) {
      const first = Array.from(this.processedSignatures.keys())[0];
      if (first) this.processedSignatures.delete(first);
    }
  }

  public async processSignature(signature: string, monitoredWallet: string): Promise<ParsedWalletTrade | null> {
    if (this.isSignatureProcessed(signature)) {
      loggerService.emit('TRANSACTION_DUPLICATE', `Skipping duplicate signature ${signature}`, { wallet: monitoredWallet, transactionSignature: signature });
      return null;
    }

    this.recordSignature(signature);
    loggerService.emit('TRANSACTION_DETECTED', `Transaction signature detected: ${signature}`, { wallet: monitoredWallet, transactionSignature: signature });

    try {
      const connection = ConnectionFactory.getConnectionForRole('monitor');
      const tx = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx) {
        loggerService.emit('TRANSACTION_REJECTED', `Could not fetch transaction details for ${signature}`, { wallet: monitoredWallet, transactionSignature: signature, level: 'warn' });
        return null;
      }

      const parsed = parseWalletTransaction(tx, monitoredWallet);
      if (!parsed) {
        loggerService.emit('TRANSACTION_REJECTED', `Transaction ${signature} rejected: not owned or valid for wallet ${monitoredWallet}`, { wallet: monitoredWallet, transactionSignature: signature, level: 'debug' });
        return null;
      }

      loggerService.emit('TRANSACTION_PARSED', `Parsed ${parsed.type.toUpperCase()} trade for ${parsed.mint} (${parsed.amount}) by ${monitoredWallet}`, {
        wallet: monitoredWallet,
        transactionSignature: signature,
        tokenMint: parsed.mint,
      });

      // Persist to repository asynchronously
      transactionRepository.saveTransaction({
        id: signature,
        signature,
        walletAddress: monitoredWallet,
        type: parsed.type,
        mint: parsed.mint,
        amount: parsed.amount,
        timestamp: parsed.timestampMs,
      }).then(() => {
        loggerService.emit('TRANSACTION_PERSISTED', `Persisted tx ${signature}`, { wallet: monitoredWallet, transactionSignature: signature });
      }).catch(err => {
        console.warn('Failed to persist transaction record:', err);
      });

      return parsed;
    } catch (err: any) {
      loggerService.emit('TRANSACTION_REJECTED', `Error processing signature ${signature}: ${err?.message}`, { wallet: monitoredWallet, transactionSignature: signature, level: 'error' });
      return null;
    }
  }
}

export const walletTransactionProcessor = new WalletTransactionProcessor();
