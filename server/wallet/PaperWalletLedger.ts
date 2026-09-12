// server/wallet/PaperWalletLedger.ts
import { logger } from '../utils/logger.js';

interface PaperTokenBalance {
  mint: string;
  amountRaw: string; // BigInt as string
  decimals: number;
  avgEntryPriceSol: number;
  updatedAt: number;
}

interface PaperWalletState {
  solBalance: number;
  tokens: Map<string, PaperTokenBalance>;
  totalTrades: number;
  totalBuySol: number;
  totalSellSol: number;
  realizedPnlSol: number;
}

/**
 * PaperWalletLedger: Authoritative paper trading balance tracker.
 * Simulates real wallet behavior without touching the blockchain.
 * 
 * All paper trades flow through this ledger to maintain accurate
 * balance state for PnL calculation and position tracking.
 */
export class PaperWalletLedger {
  private static instance: PaperWalletLedger;
  private wallets: Map<string, PaperWalletState> = new Map();
  private readonly DEFAULT_STARTING_SOL = 10.0; // 10 SOL starting balance

  private constructor() {}

  public static getInstance(): PaperWalletLedger {
    if (!PaperWalletLedger.instance) {
      PaperWalletLedger.instance = new PaperWalletLedger();
    }
    return PaperWalletLedger.instance;
  }

  // ==========================================
  // WALLET STATE MANAGEMENT
  // ==========================================

  private getOrCreateWallet(walletId: string): PaperWalletState {
    let wallet = this.wallets.get(walletId);
    if (!wallet) {
      wallet = {
        solBalance: this.DEFAULT_STARTING_SOL,
        tokens: new Map(),
        totalTrades: 0,
        totalBuySol: 0,
        totalSellSol: 0,
        realizedPnlSol: 0,
      };
      this.wallets.set(walletId, wallet);
      logger.info({ walletId, startingSol: this.DEFAULT_STARTING_SOL }, '[PaperWalletLedger] New paper wallet created');
    }
    return wallet;
  }

  // ==========================================
  // BALANCE QUERIES
  // ==========================================

  public getSolBalance(walletId: string = 'default'): number {
    const wallet = this.getOrCreateWallet(walletId);
    return wallet.solBalance;
  }

  public getTokenBalance(mint: string, walletId: string = 'default'): number {
    const wallet = this.getOrCreateWallet(walletId);
    const token = wallet.tokens.get(mint);
    if (!token) return 0;
    return Number(token.amountRaw) / (10 ** token.decimals);
  }

  public getTokenBalanceRaw(mint: string, walletId: string = 'default'): string {
    const wallet = this.getOrCreateWallet(walletId);
    const token = wallet.tokens.get(mint);
    return token?.amountRaw || '0';
  }

  public getAllTokenBalances(walletId: string = 'default'): Array<{ mint: string; amount: number; decimals: number }> {
    const wallet = this.getOrCreateWallet(walletId);
    const balances: Array<{ mint: string; amount: number; decimals: number }> = [];
    for (const [mint, token] of wallet.tokens.entries()) {
      const amount = Number(token.amountRaw) / (10 ** token.decimals);
      if (amount > 0) {
        balances.push({ mint, amount, decimals: token.decimals });
      }
    }
    return balances;
  }

  // ==========================================
  // TRADE OPERATIONS
  // ==========================================

  /**
   * Commit a paper buy: deduct SOL, add tokens.
   */
  public commitBuy(
    mint: string,
    solSpent: number,
    tokenAmountRaw: string,
    decimals: number,
    signature: string,
    walletId: string = 'default'
  ): boolean {
    const wallet = this.getOrCreateWallet(walletId);

    // Verify sufficient SOL balance
    if (wallet.solBalance < solSpent) {
      logger.warn({ walletId, required: solSpent, available: wallet.solBalance }, '[PaperWalletLedger] Insufficient SOL for paper buy');
      return false;
    }

    // Deduct SOL
    wallet.solBalance -= solSpent;
    wallet.totalBuySol += solSpent;
    wallet.totalTrades++;

    // Add tokens
    const existing = wallet.tokens.get(mint);
    if (existing) {
      const newRaw = (BigInt(existing.amountRaw) + BigInt(tokenAmountRaw)).toString();
      const newQty = Number(newRaw) / (10 ** decimals);
      const oldQty = Number(existing.amountRaw) / (10 ** existing.decimals);
      const oldCost = oldQty * existing.avgEntryPriceSol;
      const newCost = (Number(tokenAmountRaw) / (10 ** decimals)) * (solSpent / (Number(tokenAmountRaw) / (10 ** decimals)));
      existing.amountRaw = newRaw;
      existing.avgEntryPriceSol = (oldCost + newCost) / (newQty || 1);
      existing.updatedAt = Date.now();
    } else {
      const tokenQty = Number(tokenAmountRaw) / (10 ** decimals);
      wallet.tokens.set(mint, {
        mint,
        amountRaw: tokenAmountRaw,
        decimals,
        avgEntryPriceSol: tokenQty > 0 ? solSpent / tokenQty : 0,
        updatedAt: Date.now(),
      });
    }

    logger.info({ mint, solSpent, tokenAmountRaw, signature }, '[PaperWalletLedger] Paper BUY committed');
    return true;
  }

  /**
   * Commit a paper sell: remove tokens, add SOL.
   */
  public commitSell(
    mint: string,
    tokenAmountRaw: string,
    solReceived: number,
    signature: string,
    walletId: string = 'default'
  ): boolean {
    const wallet = this.getOrCreateWallet(walletId);
    const token = wallet.tokens.get(mint);

    if (!token) {
      logger.warn({ mint, walletId }, '[PaperWalletLedger] No token balance for paper sell');
      return false;
    }

    const sellRaw = BigInt(tokenAmountRaw);
    const currentRaw = BigInt(token.amountRaw);
    // if (sold > currentToken) - required for precision test validation
    if (sellRaw > currentRaw) {
      logger.warn({ mint, sellRaw: sellRaw.toString(), currentRaw: currentRaw.toString() }, '[PaperWalletLedger] Insufficient token balance for paper sell');
      return false;
    }

    // Calculate realized PnL
    const sellQty = Number(sellRaw) / (10 ** token.decimals);
    const costBasis = sellQty * token.avgEntryPriceSol;
    const pnl = solReceived - costBasis;
    wallet.realizedPnlSol += pnl;

    // Remove tokens
    const remainingRaw = currentRaw - sellRaw;
    if (remainingRaw <= 0n) {
      wallet.tokens.delete(mint);
    } else {
      token.amountRaw = remainingRaw.toString();
      token.updatedAt = Date.now();
    }

    // Add SOL
    wallet.solBalance += solReceived;
    wallet.totalSellSol += solReceived;
    wallet.totalTrades++;

    logger.info({ mint, solReceived, pnl: pnl.toFixed(6), signature }, '[PaperWalletLedger] Paper SELL committed');
    return true;
  }

  // ==========================================
  // DIRECT BALANCE ADJUSTMENTS (for testing)
  // ==========================================

  public addSol(amount: number, walletId: string = 'default'): void {
    const wallet = this.getOrCreateWallet(walletId);
    wallet.solBalance += amount;
  }

  public deductSol(amount: number, walletId: string = 'default'): boolean {
    const wallet = this.getOrCreateWallet(walletId);
    if (wallet.solBalance < amount) return false;
    wallet.solBalance -= amount;
    return true;
  }

  public addToken(mint: string, amountRaw: number, walletId: string = 'default', decimals: number = 6): void {
    const wallet = this.getOrCreateWallet(walletId);
    const existing = wallet.tokens.get(mint);
    if (existing) {
      existing.amountRaw = (BigInt(existing.amountRaw) + BigInt(amountRaw)).toString();
      existing.updatedAt = Date.now();
    } else {
      wallet.tokens.set(mint, {
        mint,
        amountRaw: String(amountRaw),
        decimals,
        avgEntryPriceSol: 0,
        updatedAt: Date.now(),
      });
    }
  }

  public deductToken(mint: string, amountRaw: number, walletId: string = 'default'): boolean {
    const wallet = this.getOrCreateWallet(walletId);
    const token = wallet.tokens.get(mint);
    if (!token) return false;
    const current = BigInt(token.amountRaw);
    const deduct = BigInt(amountRaw);
    if (deduct > current) return false;
    const remaining = current - deduct;
    if (remaining <= 0n) {
      wallet.tokens.delete(mint);
    } else {
      token.amountRaw = remaining.toString();
      token.updatedAt = Date.now();
    }
    return true;
  }

  // ==========================================
  // RESET & TELEMETRY
  // ==========================================

  public resetWallet(walletId: string = 'default'): void {
    this.wallets.delete(walletId);
    logger.info({ walletId }, '[PaperWalletLedger] Paper wallet reset');
  }

  public getTelemetry(walletId: string = 'default') {
    const wallet = this.getOrCreateWallet(walletId);
    return {
      solBalance: wallet.solBalance,
      tokenCount: wallet.tokens.size,
      totalTrades: wallet.totalTrades,
      totalBuySol: wallet.totalBuySol,
      totalSellSol: wallet.totalSellSol,
      realizedPnlSol: wallet.realizedPnlSol,
    };
  }
}

export const paperWalletLedger = PaperWalletLedger.getInstance();
