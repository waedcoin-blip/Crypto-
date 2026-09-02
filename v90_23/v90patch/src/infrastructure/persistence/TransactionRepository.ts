import { BaseFirestoreRepository } from './FirestoreRepository';

export interface ParsedTransactionRecord {
  id: string; // signature
  signature: string;
  walletAddress: string;
  type: 'buy' | 'sell';
  mint: string;
  amount: number;
  timestamp: number;
  slot?: number;
}

export interface TransactionRepositoryPort {
  saveTransaction(tx: ParsedTransactionRecord): Promise<void>;
  getTransaction(signature: string): Promise<ParsedTransactionRecord | null>;
  getTransactionsByWallet(walletAddress: string): Promise<ParsedTransactionRecord[]>;
}

export class TransactionRepository extends BaseFirestoreRepository<ParsedTransactionRecord> implements TransactionRepositoryPort {
  constructor() {
    super('walletTransactions');
  }

  public async saveTransaction(tx: ParsedTransactionRecord): Promise<void> {
    const { id, ...data } = tx;
    return this.save(id, data);
  }

  public async getTransaction(signature: string): Promise<ParsedTransactionRecord | null> {
    return this.getById(signature);
  }

  public async getTransactionsByWallet(walletAddress: string): Promise<ParsedTransactionRecord[]> {
    const all = await this.listAll();
    return all.filter(t => t.walletAddress === walletAddress);
  }
}

export const transactionRepository = new TransactionRepository();
