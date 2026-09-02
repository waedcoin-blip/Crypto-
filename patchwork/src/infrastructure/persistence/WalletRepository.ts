import { BaseFirestoreRepository } from './FirestoreRepository';

export interface WalletRecord {
  id: string;
  name: string;
  address: string;
  tier: 'alpha' | 'beta' | 'whale' | 'degen';
  winRate: number;
  avgMultiplier: number;
  totalProfitSol: number;
  trackedTokens: string[];
  status: 'active' | 'paused' | 'error';
  lastSeenMs?: number;
  updatedAt: number;
}

export interface WalletRepositoryPort {
  getWallet(id: string): Promise<WalletRecord | null>;
  saveWallet(wallet: WalletRecord): Promise<void>;
  deleteWallet(id: string): Promise<void>;
  getAllWallets(): Promise<WalletRecord[]>;
}

export class WalletRepository extends BaseFirestoreRepository<WalletRecord> implements WalletRepositoryPort {
  constructor() {
    super('monitoredWallets');
  }

  public async getWallet(id: string): Promise<WalletRecord | null> {
    return this.getById(id);
  }

  public async saveWallet(wallet: WalletRecord): Promise<void> {
    const { id, ...data } = wallet;
    return this.save(id, data);
  }

  public async deleteWallet(id: string): Promise<void> {
    return this.remove(id);
  }

  public async getAllWallets(): Promise<WalletRecord[]> {
    return this.listAll();
  }
}

export const walletRepository = new WalletRepository();
