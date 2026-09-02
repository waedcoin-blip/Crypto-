// server/wallet/WalletManager.ts
import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

export type WalletIdentity = 'paper:default' | 'devnet:wallet_a' | 'devnet:wallet_b' | 'mainnet:default' | string;

export interface WalletAccount {
  identity: WalletIdentity;
  network: 'paper' | 'devnet' | 'mainnet';
  publicKey: string;
  keypair?: Keypair;
  description: string;
}

export class WalletManager {
  private static instance: WalletManager;
  private accounts: Map<WalletIdentity, WalletAccount> = new Map();

  private constructor() {
    this.initializeWallets();
  }

  public static getInstance(): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager();
    }
    return WalletManager.instance;
  }

  private initializeWallets(): void {
    // 1. Paper Wallet
    this.accounts.set('paper:default', {
      identity: 'paper:default',
      network: 'paper',
      publicKey: '11111111111111111111111111111111',
      description: 'Paper Trading Simulated Wallet',
    });

    // 2. Devnet Wallet A
    const devnetKeyA = process.env.DEVNET_WALLET_A_PRIVATE_KEY || process.env.DEVNET_PRIVATE_KEY;
    let keypairDevnetA: Keypair | undefined;
    let pubkeyDevnetA = 'DevnetWalletA111111111111111111111111111111';
    if (devnetKeyA) {
      try {
        const secret = bs58.decode(devnetKeyA);
        keypairDevnetA = Keypair.fromSecretKey(secret);
        pubkeyDevnetA = keypairDevnetA.publicKey.toBase58();
      } catch (e) {
        // Fallback
      }
    }
    this.accounts.set('devnet:wallet_a', {
      identity: 'devnet:wallet_a',
      network: 'devnet',
      publicKey: pubkeyDevnetA,
      keypair: keypairDevnetA,
      description: 'Devnet Trading Wallet A',
    });

    // 3. Devnet Wallet B
    const devnetKeyB = process.env.DEVNET_WALLET_B_PRIVATE_KEY;
    let keypairDevnetB: Keypair | undefined;
    let pubkeyDevnetB = 'DevnetWalletB111111111111111111111111111111';
    if (devnetKeyB) {
      try {
        const secret = bs58.decode(devnetKeyB);
        keypairDevnetB = Keypair.fromSecretKey(secret);
        pubkeyDevnetB = keypairDevnetB.publicKey.toBase58();
      } catch (e) {
        // Fallback
      }
    }
    this.accounts.set('devnet:wallet_b', {
      identity: 'devnet:wallet_b',
      network: 'devnet',
      publicKey: pubkeyDevnetB,
      keypair: keypairDevnetB,
      description: 'Devnet Trading Wallet B',
    });

    // 4. Mainnet Wallet
    const mainnetKey = process.env.MAINNET_PRIVATE_KEY || process.env.SOLANA_PRIVATE_KEY;
    let keypairMainnet: Keypair | undefined;
    let pubkeyMainnet = 'MainnetWallet1111111111111111111111111111111';
    if (mainnetKey) {
      try {
        const secret = bs58.decode(mainnetKey);
        keypairMainnet = Keypair.fromSecretKey(secret);
        pubkeyMainnet = keypairMainnet.publicKey.toBase58();
      } catch (e) {
        // Fallback
      }
    }
    this.accounts.set('mainnet:default', {
      identity: 'mainnet:default',
      network: 'mainnet',
      publicKey: pubkeyMainnet,
      keypair: keypairMainnet,
      description: 'Mainnet Trading Primary Wallet',
    });
  }

  public getAccount(identity: WalletIdentity): WalletAccount {
    const acc = this.accounts.get(identity);
    if (acc) return acc;

    // Fallback resolution by network prefix
    if (identity.startsWith('paper')) return this.accounts.get('paper:default')!;
    if (identity.startsWith('devnet')) return this.accounts.get('devnet:wallet_a')!;
    if (identity.startsWith('mainnet')) return this.accounts.get('mainnet:default')!;

    throw new Error(`UNKNOWN_WALLET_IDENTITY: ${identity}`);
  }

  public getAccountByNetworkAndWallet(network: string, walletName?: string): WalletAccount {
    if (network === 'paper') return this.getAccount('paper:default');
    if (network === 'devnet') {
      if (walletName === 'wallet_b' || walletName === 'devnet:wallet_b') {
        return this.getAccount('devnet:wallet_b');
      }
      return this.getAccount('devnet:wallet_a');
    }
    return this.getAccount('mainnet:default');
  }

  public getAllAccounts(): WalletAccount[] {
    return Array.from(this.accounts.values());
  }
}

export const walletManager = WalletManager.getInstance();
