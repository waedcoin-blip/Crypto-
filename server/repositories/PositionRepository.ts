// server/repositories/PositionRepository.ts
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type PositionState =
  | 'PENDING_BUY'
  | 'OPEN'
  | 'EXIT_REQUESTED'
  | 'EXIT_SUBMITTED'
  | 'EXIT_CONFIRMING'
  | 'CLOSED'
  | 'RECOVERY_REQUIRED';

export interface PositionRecord {
  id: string;
  mintAddress: string;
  network: string;
  wallet?: string;
  amountRaw: number | string;
  decimals: number;
  entryPriceSOL: number;
  solSpent: number;
  currentPriceSOL: number;
  peakPriceSOL: number;
  highestPnLPct: number;
  currentPnLSol?: number;
  currentPnLPct?: number;
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  slippageBpsTp: number;
  slippageBpsSl: number;
  state: PositionState;
  orderIds: string[];
  buySignature?: string;
  exitSignature?: string;
  createdAt: number;
  updatedAt: number;
  lastMarketPriceAt?: number;
  lastExecutableQuoteAt?: number;
  lastMarketEventAt?: number;
  lastExitEvaluationAt?: number;
  closedAt?: number;
  realizedPnLSol?: number;
  realizedPnLPct?: number;
  version?: number;
}

export class PositionRepository {
  private static instance: PositionRepository;
  private db: DatabaseSync;

  private constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'positions.db');
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.initTable();
  }

  public static getInstance(): PositionRepository {
    if (!PositionRepository.instance) {
      PositionRepository.instance = new PositionRepository();
    }
    return PositionRepository.instance;
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        mint_address TEXT NOT NULL,
        network TEXT NOT NULL,
        wallet TEXT,
        amount_raw TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        entry_price_sol REAL NOT NULL,
        sol_spent REAL NOT NULL,
        current_price_sol REAL NOT NULL,
        peak_price_sol REAL NOT NULL,
        highest_pnl_pct REAL NOT NULL,
        current_pnl_sol REAL,
        current_pnl_pct REAL,
        tp_pct REAL NOT NULL,
        sl_pct REAL NOT NULL,
        trailing_sl_pct REAL,
        max_hold_time_ms INTEGER,
        slippage_bps_tp INTEGER NOT NULL,
        slippage_bps_sl INTEGER NOT NULL,
        state TEXT NOT NULL,
        order_ids TEXT NOT NULL,
        buy_signature TEXT,
        exit_signature TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_market_price_at INTEGER,
        last_executable_quote_at INTEGER,
        last_market_event_at INTEGER,
        last_exit_evaluation_at INTEGER,
        closed_at INTEGER,
        realized_pnl_sol REAL,
        realized_pnl_pct REAL,
        version INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  private mapRowToRecord(r: any): PositionRecord {
    let orderIds: string[] = [];
    try {
      orderIds = JSON.parse(r.order_ids || '[]');
    } catch {
      orderIds = [];
    }

    return {
      id: r.id,
      mintAddress: r.mint_address,
      network: r.network,
      wallet: r.wallet || 'default',
      amountRaw: r.amount_raw,
      decimals: r.decimals,
      entryPriceSOL: r.entry_price_sol,
      solSpent: r.sol_spent,
      currentPriceSOL: r.current_price_sol,
      peakPriceSOL: r.peak_price_sol,
      highestPnLPct: r.highest_pnl_pct,
      currentPnLSol: r.current_pnl_sol ?? undefined,
      currentPnLPct: r.current_pnl_pct ?? undefined,
      tpPct: r.tp_pct,
      slPct: r.sl_pct,
      trailingSlPct: r.trailing_sl_pct ?? undefined,
      maxHoldTimeMs: r.max_hold_time_ms ?? undefined,
      slippageBpsTp: r.slippage_bps_tp,
      slippageBpsSl: r.slippage_bps_sl,
      state: r.state as PositionState,
      orderIds,
      buySignature: r.buy_signature ?? undefined,
      exitSignature: r.exit_signature ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastMarketPriceAt: r.last_market_price_at ?? undefined,
      lastExecutableQuoteAt: r.last_executable_quote_at ?? undefined,
      lastMarketEventAt: r.last_market_event_at ?? undefined,
      lastExitEvaluationAt: r.last_exit_evaluation_at ?? undefined,
      closedAt: r.closed_at ?? undefined,
      realizedPnLSol: r.realized_pnl_sol ?? undefined,
      realizedPnLPct: r.realized_pnl_pct ?? undefined,
      version: r.version,
    };
  }

  public getAllPositions(): PositionRecord[] {
    const stmt = this.db.prepare('SELECT * FROM positions ORDER BY created_at DESC');
    const rows = stmt.all() as any[];
    return rows.map(r => this.mapRowToRecord(r));
  }

  public getOpenPositions(network?: string): PositionRecord[] {
    if (network) {
      const stmt = this.db.prepare("SELECT * FROM positions WHERE state != 'CLOSED' AND network = ? ORDER BY created_at DESC");
      const rows = stmt.all(network) as any[];
      return rows.map(r => this.mapRowToRecord(r));
    }
    const stmt = this.db.prepare("SELECT * FROM positions WHERE state != 'CLOSED' ORDER BY created_at DESC");
    const rows = stmt.all() as any[];
    return rows.map(r => this.mapRowToRecord(r));
  }

  public countActivePositions(network?: string): number {
    return this.getOpenPositions(network).length;
  }

  public canOpenPosition(maxPositions: number, network?: string): boolean {
    if (maxPositions <= 0) return true;
    return this.countActivePositions(network) < maxPositions;
  }

  public getPosition(id: string): PositionRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM positions WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.mapRowToRecord(row) : undefined;
  }

  public getPositionByMint(mint: string, network?: string): PositionRecord | undefined {
    const cleanMint = mint.trim();
    if (network) {
      const stmt = this.db.prepare("SELECT * FROM positions WHERE mint_address = ? AND state != 'CLOSED' AND network = ? LIMIT 1");
      const row = stmt.get(cleanMint, network) as any;
      return row ? this.mapRowToRecord(row) : undefined;
    }
    const stmt = this.db.prepare("SELECT * FROM positions WHERE mint_address = ? AND state != 'CLOSED' LIMIT 1");
    const row = stmt.get(cleanMint) as any;
    return row ? this.mapRowToRecord(row) : undefined;
  }

  /**
   * Atomic Upsert with strict state-machine guard against resurrecting CLOSED positions.
   */
  public upsertPosition(position: PositionRecord): PositionRecord {
    const now = Date.now();
    const existing = this.getPosition(position.id);

    if (existing) {
      // 🔴 STATE MACHINE GUARD: A position already marked CLOSED can NEVER be overwritten back to OPEN
      if (existing.state === 'CLOSED' && position.state !== 'CLOSED') {
        console.warn(`[PositionRepository] Prevented resurrecting CLOSED position ${position.id} to state ${position.state}`);
        return existing;
      }
    }

    const nextVersion = existing ? (existing.version || 1) + 1 : 1;
    const orderIdsJson = JSON.stringify(position.orderIds || []);
    const amountRawStr = String(position.amountRaw);

    const stmt = this.db.prepare(`
      INSERT INTO positions (
        id, mint_address, network, wallet, amount_raw, decimals, entry_price_sol, sol_spent,
        current_price_sol, peak_price_sol, highest_pnl_pct, current_pnl_sol, current_pnl_pct,
        tp_pct, sl_pct, trailing_sl_pct, max_hold_time_ms, slippage_bps_tp, slippage_bps_sl,
        state, order_ids, buy_signature, exit_signature, created_at, updated_at,
        last_market_price_at, last_executable_quote_at, last_market_event_at, last_exit_evaluation_at,
        closed_at, realized_pnl_sol, realized_pnl_pct, version
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        mint_address = excluded.mint_address,
        network = excluded.network,
        wallet = excluded.wallet,
        amount_raw = excluded.amount_raw,
        decimals = excluded.decimals,
        entry_price_sol = excluded.entry_price_sol,
        sol_spent = excluded.sol_spent,
        current_price_sol = excluded.current_price_sol,
        peak_price_sol = excluded.peak_price_sol,
        highest_pnl_pct = excluded.highest_pnl_pct,
        current_pnl_sol = excluded.current_pnl_sol,
        current_pnl_pct = excluded.current_pnl_pct,
        tp_pct = excluded.tp_pct,
        sl_pct = excluded.sl_pct,
        trailing_sl_pct = excluded.trailing_sl_pct,
        max_hold_time_ms = excluded.max_hold_time_ms,
        slippage_bps_tp = excluded.slippage_bps_tp,
        slippage_bps_sl = excluded.slippage_bps_sl,
        state = excluded.state,
        order_ids = excluded.order_ids,
        buy_signature = excluded.buy_signature,
        exit_signature = excluded.exit_signature,
        updated_at = excluded.updated_at,
        last_market_price_at = excluded.last_market_price_at,
        last_executable_quote_at = excluded.last_executable_quote_at,
        last_market_event_at = excluded.last_market_event_at,
        last_exit_evaluation_at = excluded.last_exit_evaluation_at,
        closed_at = excluded.closed_at,
        realized_pnl_sol = excluded.realized_pnl_sol,
        realized_pnl_pct = excluded.realized_pnl_pct,
        version = excluded.version
    `);

    stmt.run(
      position.id,
      position.mintAddress,
      position.network,
      position.wallet || 'default',
      amountRawStr,
      position.decimals,
      position.entryPriceSOL,
      position.solSpent,
      position.currentPriceSOL,
      position.peakPriceSOL,
      position.highestPnLPct,
      position.currentPnLSol ?? null,
      position.currentPnLPct ?? null,
      position.tpPct,
      position.slPct,
      position.trailingSlPct ?? null,
      position.maxHoldTimeMs ?? null,
      position.slippageBpsTp,
      position.slippageBpsSl,
      position.state,
      orderIdsJson,
      position.buySignature ?? null,
      position.exitSignature ?? null,
      position.createdAt || now,
      now,
      position.lastMarketPriceAt ?? null,
      position.lastExecutableQuoteAt ?? null,
      position.lastMarketEventAt ?? null,
      position.lastExitEvaluationAt ?? null,
      position.closedAt ?? null,
      position.realizedPnLSol ?? null,
      position.realizedPnLPct ?? null,
      nextVersion
    );

    return this.getPosition(position.id) || position;
  }

  public updatePosition(id: string, patch: Partial<PositionRecord>): PositionRecord | undefined {
    const existing = this.getPosition(id);
    if (!existing) return undefined;

    // 🔴 STATE MACHINE GUARD: Closed positions cannot be reopened or mutated by price updates
    if (existing.state === 'CLOSED') {
      if (patch.state && patch.state !== 'CLOSED') {
        console.warn(`[PositionRepository] Rejected invalid transition from CLOSED to ${patch.state} for position ${id}`);
        return existing;
      }
      if (patch.currentPriceSOL !== undefined || patch.currentPnLSol !== undefined || patch.currentPnLPct !== undefined) {
        return existing;
      }
    }

    const merged: PositionRecord = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    };

    return this.upsertPosition(merged);
  }

  public closePosition(
    id: string,
    data?: { exitSignature?: string; realizedPnLSol?: number; realizedPnLPct?: number }
  ): PositionRecord | undefined {
    const existing = this.getPosition(id);
    if (!existing) return undefined;

    const now = Date.now();
    const updated: PositionRecord = {
      ...existing,
      state: 'CLOSED',
      closedAt: existing.closedAt || now,
      updatedAt: now,
      exitSignature: data?.exitSignature ?? existing.exitSignature,
      realizedPnLSol: data?.realizedPnLSol ?? existing.realizedPnLSol,
      realizedPnLPct: data?.realizedPnLPct ?? existing.realizedPnLPct,
    };

    return this.upsertPosition(updated);
  }
}

export const positionRepository = PositionRepository.getInstance();

