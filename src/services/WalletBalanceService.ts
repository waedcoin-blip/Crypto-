// src/services/WalletBalanceService.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig, TradingNetwork } from '../config/network';
import { useBalanceStore } from '../store/balanceStore';
import { useActiveWalletStore } from '../store/activeWalletStore';

const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export class WalletBalanceService {
  private connection: Connection | null = null;
  private network: TradingNetwork;
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshSeq = 0;
  private pendingClearedMints: Set<string> = new Set();

  constructor(network: TradingNetwork) {
    this.network = network;
    const config = getNetworkConfig(network);
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    useBalanceStore.getState().setNetwork(network);
  }

  /**
   * Registers a token mint as pending cleared (sold), setting its local balance to 0
   * and protecting it from being overwritten by stale RPC balance responses.
   */
  public markTokenCleared(mint: string): void {
    this.pendingClearedMints.add(mint);
    useBalanceStore.getState().setTokenBalance(mint, 0);
  }

  /**
   * Polls the on-chain balance for a sold token until it is verified cleared (0)
   * or max attempts are reached, preserving the optimistic zero in local state.
   */
  async verifyTokenBalanceCleared(
    mint: string,
    walletAddress?: string,
    maxAttempts = 10,
    intervalMs = 400
  ): Promise<boolean> {
    this.markTokenCleared(mint);

    let isCleared = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const rawBalance = await this.getTokenBalance(mint, walletAddress);
        if (rawBalance === 0) {
          isCleared = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    // Keep in pendingClearedMints briefly to ensure subsequent full refreshes capture 0
    setTimeout(() => {
      this.pendingClearedMints.delete(mint);
    }, 2500);

    // Run a final refresh now that on-chain state is confirmed cleared
    void this.refresh(walletAddress);
    return isCleared;
  }

  refreshNow(address?: string) {
    void this.refresh(address);
  }

  /**
   * Refreshes wallet balance with multiple attempts and settling delay,
   * guaranteeing that on-chain settlement and balance changes are captured.
   */
  async refreshWithRetry(address?: string, retries = 3, delayMs = 500): Promise<number> {
    let finalSol = 0;
    for (let i = 0; i < retries; i++) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      finalSol = await this.refresh(address);
    }
    return finalSol;
  }

  start(intervalMs: number) {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), intervalMs);
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
  }

  public updateNetwork(network: TradingNetwork): void {
    this.network = network;
    const config = getNetworkConfig(network);
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    useBalanceStore.getState().setNetwork(network);
    void this.refresh();
  }

  async refresh(overrideAddress?: string): Promise<number> {
    const address = overrideAddress || useActiveWalletStore.getState().activeWallet?.address;
    if (!address) {
      useBalanceStore.getState().setWalletAddress(null);
      return 0;
    }
    const currentSeq = ++this.refreshSeq;
    try {
      if (!this.connection) {
        const config = getNetworkConfig(this.network);
        this.connection = new Connection(config.rpcUrl, 'confirmed');
      }
      useBalanceStore.getState().setWalletAddress(address);
      const publicKey = new PublicKey(address);

      // 1. Fetch exact SOL balance directly from RPC
      const balance = await this.connection.getBalance(publicKey, 'confirmed');
      const sol = balance / LAMPORTS_PER_SOL;

      // 2. Fetch ALL token accounts across SPL Token & Token-2022 programs
      const [tokenAccounts, t22Accounts] = await Promise.all([
        this.connection.getParsedTokenAccountsByOwner(
          publicKey,
          { programId: TOKEN_PROGRAM_ID },
          'confirmed'
        ).catch(() => ({ value: [] })),
        this.connection.getParsedTokenAccountsByOwner(
          publicKey,
          { programId: TOKEN_2022_PROGRAM_ID },
          'confirmed'
        ).catch(() => ({ value: [] })),
      ]);

      // Guard against older out-of-order RPC responses overwriting newer balances
      if (currentSeq < this.refreshSeq) {
        return sol;
      }

      const allAccounts = [...tokenAccounts.value, ...t22Accounts.value];
      const tokenBalances: Record<string, number> = {};

      for (const { account } of allAccounts) {
        const parsed = account.data.parsed?.info;
        if (!parsed) continue;
        const mint: string = parsed.mint;
        if (this.pendingClearedMints.has(mint)) {
          tokenBalances[mint] = 0;
          continue;
        }
        const ta = parsed.tokenAmount;
        const uiAmt = ta.uiAmount ?? Number(ta.amount) / Math.pow(10, ta.decimals);
        // Correctly aggregate across multiple token accounts for same mint
        tokenBalances[mint] = (tokenBalances[mint] || 0) + uiAmt;
      }

      // 3. Push authoritative balance to store
      const bs = useBalanceStore.getState();
      bs.setOnChainBalance({ solBalance: sol });

      if ('setTokenBalances' in bs && typeof (bs as any).setTokenBalances === 'function') {
        (bs as any).setTokenBalances(tokenBalances);
      } else if ('setTokenBalance' in bs && typeof (bs as any).setTokenBalance === 'function') {
        for (const [mint, bal] of Object.entries(tokenBalances)) {
          (bs as any).setTokenBalance(mint, bal);
        }
      }

      return sol;
    } catch (err) {
      console.warn('Wallet balance query error for', address, err);
      return 0;
    }
  }

  /**
   * Fetch raw on-chain SPL token account balance for a specific mint across all accounts (SPL Token & Token-2022).
   * Throws on RPC error so callers NEVER interpret RPC failure as zero balance.
   */
  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {
    const address = walletAddress || useActiveWalletStore.getState().activeWallet?.address;
    if (!address) return 0;

    if (!this.connection) {
      const config = getNetworkConfig(this.network);
      this.connection = new Connection(config.rpcUrl, 'confirmed');
    }
    const owner = new PublicKey(address);
    const mintPk = new PublicKey(mint);

    // Fetch parsed token accounts for target mint (covers both legacy SPL and Token-2022)
    const accounts = await this.connection.getParsedTokenAccountsByOwner(
      owner,
      { mint: mintPk },
      'confirmed'
    );

    let totalRawAmount = 0;
    for (const account of accounts.value) {
      const amountStr = account.account.data.parsed?.info?.tokenAmount?.amount;
      if (amountStr) {
        totalRawAmount += Number(amountStr);
      }
    }
    return totalRawAmount;
  }
}

export const walletBalanceService = new WalletBalanceService('devnet');
