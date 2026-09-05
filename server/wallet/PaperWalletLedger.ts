// server/wallet/PaperWalletLedger.ts
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface PaperTransaction {
  id: string;
  type: 'BUY' | 'SELL' | 'RESET';
  mint?: string;
  solAmount: number;
  tokenAmountRaw: number;
  decimals: number;
  signature: string;
  timestamp: number;
}

export class PaperWalletLedger {
  private static instance: PaperWalletLedger;
  private db: DatabaseSync;

  private constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'paper_wallet.db');
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.initTables();
  }

  public static getInstance(): PaperWalletLedger {
    if (!PaperWalletLedger.instance) {
      PaperWalletLedger.instance = new PaperWalletLedger();
    }
    return PaperWalletLedger.instance;
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_balances (
        asset_key TEXT PRIMARY KEY,
        balance_raw TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS paper_transactions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        mint TEXT,
        sol_amount REAL NOT NULL,
        token_amount_raw TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        signature TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);

    // Ensure initial SOL balance exists
    const solStmt = this.db.prepare("SELECT * FROM wallet_balances WHERE asset_key = 'SOL'");
    const existingSol = solStmt.get() as any;
    if (!existingSol) {
      this.setSolBalance(100.0);
    }
  }

  public getSolBalance(): number {
    const stmt = this.db.prepare("SELECT balance_raw FROM wallet_balances WHERE asset_key = 'SOL'");
    const row = stmt.get() as any;
    if (!row) return 100.0;
    return Number(row.balance_raw) / 1e9;
  }

  public setSolBalance(solAmount: number): void {
    const lamportsStr = String(Math.floor(solAmount * 1e9));
    const stmt = this.db.prepare(`
      INSERT INTO wallet_balances (asset_key, balance_raw, decimals, updated_at)
      VALUES ('SOL', ?, 9, ?)
      ON CONFLICT(asset_key) DO UPDATE SET balance_raw = excluded.balance_raw, updated_at = excluded.updated_at
    `);
    stmt.run(lamportsStr, Date.now());
  }

  public getTokenBalance(mint: string): number {
    const stmt = this.db.prepare('SELECT balance_raw FROM wallet_balances WHERE asset_key = ?');
    const row = stmt.get(mint) as any;
    if (!row) return 0;
    return Number(row.balance_raw);
  }

  public setTokenBalance(mint: string, rawAmount: number, decimals: number = 9): void {
    const rawStr = String(Math.floor(rawAmount));
    const stmt = this.db.prepare(`
      INSERT INTO wallet_balances (asset_key, balance_raw, decimals, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(asset_key) DO UPDATE SET balance_raw = excluded.balance_raw, updated_at = excluded.updated_at
    `);
    stmt.run(mint, rawStr, decimals, Date.now());
  }

  public commitBuy(mint: string, solSpent: number, tokenAmountRaw: number, decimals: number, signature: string): void {
    const currentSol = this.getSolBalance();
    const newSol = Math.max(0, currentSol - solSpent);
    this.setSolBalance(newSol);

    const currentToken = this.getTokenBalance(mint);
    this.setTokenBalance(mint, currentToken + tokenAmountRaw, decimals);

    const txStmt = this.db.prepare(`
      INSERT INTO paper_transactions (id, type, mint, sol_amount, token_amount_raw, decimals, signature, timestamp)
      VALUES (?, 'BUY', ?, ?, ?, ?, ?, ?)
    `);
    txStmt.run(`tx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`, mint, solSpent, String(tokenAmountRaw), decimals, signature, Date.now());
  }

  public commitSell(mint: string, solGained: number, tokenAmountRaw: number, decimals: number, signature: string): void {
    const currentSol = this.getSolBalance();
    this.setSolBalance(currentSol + solGained);

    const currentToken = this.getTokenBalance(mint);
    const newToken = Math.max(0, currentToken - tokenAmountRaw);
    this.setTokenBalance(mint, newToken, decimals);

    const txStmt = this.db.prepare(`
      INSERT INTO paper_transactions (id, type, mint, sol_amount, token_amount_raw, decimals, signature, timestamp)
      VALUES (?, 'SELL', ?, ?, ?, ?, ?, ?)
    `);
    txStmt.run(`tx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`, mint, solGained, String(tokenAmountRaw), decimals, signature, Date.now());
  }

  public reset(solBalance: number = 100.0): void {
    this.db.exec('DELETE FROM wallet_balances;');
    this.db.exec('DELETE FROM paper_transactions;');
    this.setSolBalance(solBalance);
  }
}

export const paperWalletLedger = PaperWalletLedger.getInstance();
