// src/services/connectedWalletService.ts
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

export interface ConnectedWalletSigner {
  publicKey: PublicKey;
  signTransaction?: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(transactions: T[]) => Promise<T[]>;
  sendTransaction?: (
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: any
  ) => Promise<string>;
  walletName?: string;
}

class ConnectedWalletService {
  private signer: ConnectedWalletSigner | null = null;

  public setSigner(signer: ConnectedWalletSigner | null) {
    this.signer = signer;
  }

  public getSigner(): ConnectedWalletSigner | null {
    return this.signer;
  }

  public getPublicKey(): PublicKey | null {
    return this.signer?.publicKey || null;
  }

  public getAddress(): string {
    return this.signer?.publicKey?.toBase58() || '';
  }

  public isConnected(): boolean {
    return !!this.signer && !!this.signer.publicKey;
  }

  public verifySigner(expectedAddress: string): { valid: boolean; error?: string } {
    if (!this.signer || !this.signer.publicKey) {
      return {
        valid: false,
        error: `Connected wallet is active (${expectedAddress}), but browser wallet extension is disconnected or unavailable.`,
      };
    }

    const connectedAddress = this.signer.publicKey.toBase58();
    if (connectedAddress !== expectedAddress) {
      return {
        valid: false,
        error: `Connected wallet address mismatch. Active: ${expectedAddress}, Connected browser wallet: ${connectedAddress}`,
      };
    }

    if (!this.signer.signTransaction && !this.signer.sendTransaction) {
      return {
        valid: false,
        error: `Connected wallet (${this.signer.walletName || 'Browser Wallet'}) does not support transaction signing or sending.`,
      };
    }

    return { valid: true };
  }
}

export const connectedWalletService = new ConnectedWalletService();
