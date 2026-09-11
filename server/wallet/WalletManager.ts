// server/wallet/WalletManager.ts
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  Transaction,
  sendAndConfirmRawTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../config/index.js';
import { getPrimaryRpc } from '../config/rpcRouting.js';
import { logger } from '../utils/logger.js';

/**
 * WalletManager: Authoritative server-side keypair management.
 * 
 * SECURITY INVARIANTS:
 * - Private keys are ONLY loaded from process.env
 * - Private keys are NEVER logged, serialized, or exposed via API
 * - All signing happens server-side; frontend never sees keys
 * - Paper mode uses ephemeral keypairs (no real funds at risk)
 */
export class WalletManager {
  private static instance: WalletManager;
  private keypairs: Map<string, Keypair> = new Map();
  private defaultWallet: string = 'default';

  private constructor() {}

  public static getInstance(): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager();
    }
    return WalletManager.instance;
  }

  // ==========================================
  // WALLET CREATION / LOADING
  // ==========================================

  /**
   * Get or create a wallet keypair.
   * In production, loads from PRIVATE_KEY env var.
   * In paper mode, generates an ephemeral keypair.
   */
  public async getOrCreateWallet(walletId: string = 'default'): Promise<Keypair> {
    const existing = this.keypairs.get(walletId);
    if (existing) return existing;

    let keypair: Keypair;

    // Try to load from environment
    const privateKeyEnv = process.env.PRIVATE_KEY || process.env.SOLANA_PRIVATE_KEY;
    if (privateKeyEnv && walletId === 'default') {
      try {
        // Support both base58 and JSON array formats
        if (privateKeyEnv.startsWith('[')) {
          const bytes = JSON.parse(privateKeyEnv);
          keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
        } else {
          const bytes = bs58.decode(privateKeyEnv);
          keypair = Keypair.fromSecretKey(bytes);
        }
        logger.info({ wallet: keypair.publicKey.toBase58().slice(0, 8) + '...' }, '[WalletManager] Loaded wallet from env');
      } catch (err: any) {
        logger.error({ error: err.message }, '[WalletManager] Failed to parse PRIVATE_KEY from env. Generating ephemeral wallet.');
        keypair = Keypair.generate();
      }
    } else {
      // Paper mode or no key configured: generate ephemeral
      keypair = Keypair.generate();
      logger.info({ wallet: keypair.publicKey.toBase58().slice(0, 8) + '...' }, '[WalletManager] Generated ephemeral wallet (paper mode)');
    }

    this.keypairs.set(walletId, keypair);
    return keypair;
  }

  /**
   * Get the public key (address) for a wallet. Safe to expose.
   */
  public async getWalletAddress(walletId: string = 'default'): Promise<string> {
    const keypair = await this.getOrCreateWallet(walletId);
    return keypair.publicKey.toBase58();
  }

  // ==========================================
  // TRANSACTION SIGNING & BROADCASTING
  // ==========================================

  /**
   * Sign a base64-encoded transaction and broadcast it.
   * Returns the transaction signature.
   */
  public async signAndBroadcast(
    serializedTx: string,
    walletId: string = 'default',
    network: string = 'mainnet'
  ): Promise<string | null> {
    try {
      const keypair = await this.getOrCreateWallet(walletId);
      const rpcUrl = getPrimaryRpc('execution');
      if (!rpcUrl) {
        logger.error('[WalletManager] No execution RPC URL configured');
        return null;
      }

      const connection = new Connection(rpcUrl, 'confirmed');

      // Deserialize the transaction
      const txBuffer = Buffer.from(serializedTx, 'base64');
      let transaction: VersionedTransaction | Transaction;

      try {
        // Try VersionedTransaction first (Jupiter v6+)
        transaction = VersionedTransaction.deserialize(txBuffer);
        transaction.sign([keypair]);
      } catch {
        // Fallback to legacy Transaction
        transaction = Transaction.from(txBuffer);
        transaction.sign(keypair);
      }

      // Serialize signed transaction
      const signedBuffer = Buffer.from(
        transaction instanceof VersionedTransaction
          ? transaction.serialize()
          : transaction.serialize()
      );

      // Broadcast
      const signature = await connection.sendRawTransaction(signedBuffer, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      logger.info({ signature: signature.slice(0, 16) + '...', network }, '[WalletManager] Transaction broadcast');
      return signature;
    } catch (err: any) {
      logger.error({ error: err.message }, '[WalletManager] Sign and broadcast failed');
      return null;
    }
  }

  /**
   * Sign a transaction without broadcasting (for multi-sig or deferred execution).
   */
  public async signTransaction(
    serializedTx: string,
    walletId: string = 'default'
  ): Promise<string | null> {
    try {
      const keypair = await this.getOrCreateWallet(walletId);
      const txBuffer = Buffer.from(serializedTx, 'base64');

      let transaction: VersionedTransaction | Transaction;
      try {
        transaction = VersionedTransaction.deserialize(txBuffer);
        transaction.sign([keypair]);
        return Buffer.from(transaction.serialize()).toString('base64');
      } catch {
        transaction = Transaction.from(txBuffer);
        transaction.sign(keypair);
        return Buffer.from(transaction.serialize()).toString('base64');
      }
    } catch (err: any) {
      logger.error({ error: err.message }, '[WalletManager] Transaction signing failed');
      return null;
    }
  }

  // ==========================================
  // BALANCE QUERIES
  // ==========================================

  /**
   * Get SOL balance for a wallet.
   */
  public async getSolBalance(walletId: string = 'default'): Promise<number> {
    try {
      const keypair = await this.getOrCreateWallet(walletId);
      const rpcUrl = getPrimaryRpc('execution');
      if (!rpcUrl) return 0;

      const connection = new Connection(rpcUrl, 'confirmed');
      const balance = await connection.getBalance(keypair.publicKey, 'confirmed');
      return balance / 1e9;
    } catch {
      return 0;
    }
  }

  /**
   * Get token balance for a specific mint.
   */
  public async getTokenBalance(mint: string, walletId: string = 'default'): Promise<number> {
    try {
      const keypair = await this.getOrCreateWallet(walletId);
      const rpcUrl = getPrimaryRpc('execution');
      if (!rpcUrl) return 0;

      const connection = new Connection(rpcUrl, 'confirmed');
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        keypair.publicKey,
        { mint: new PublicKey(mint) }
      );

      if (tokenAccounts.value.length === 0) return 0;
      const info = tokenAccounts.value[0].account.data.parsed.info;
      return info.tokenAmount.uiAmount || 0;
    } catch {
      return 0;
    }
  }

  // ==========================================
  // SECURITY: Never expose private keys
  // ==========================================

  /**
   * Returns a safe summary of wallet state (no secrets).
   */
  public getWalletSummary(walletId: string = 'default'): { address: string | null; hasKey: boolean } {
    const keypair = this.keypairs.get(walletId);
    if (!keypair) return { address: null, hasKey: false };
    return {
      address: keypair.publicKey.toBase58(),
      hasKey: true,
    };
  }
}

export const walletManager = WalletManager.getInstance();
