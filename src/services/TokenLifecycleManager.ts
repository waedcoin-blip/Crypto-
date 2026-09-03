// src/services/TokenLifecycleManager.ts
import { systemLogger } from './systemLogger';
import { positionRegistry } from './PositionRegistry';
import { orderManager } from './OrderManager';

export type TokenLifecycleState =
  | 'DISCOVERED'
  | 'QUALIFIED'
  | 'REJECTED'
  | 'BUY_REQUESTED'
  | 'BUY_SUBMITTED'
  | 'BUY_CONFIRMED'
  | 'POSITION_OPEN'
  | 'SELL_REQUESTED'
  | 'SELL_SUBMITTED'
  | 'SELL_CONFIRMED'
  | 'POSITION_CLOSED';

export interface TokenLifecycleRecord {
  mint: string;
  symbol: string;
  state: TokenLifecycleState;
  discoveredAt: number;
  lastStateChangeAt: number;
  completedTradesCount: number;
  lastBuyAt?: number;
  lastSellAt?: number;
  cooldownUntil?: number;
  rejectionReason?: string;
}

export interface RebuyEligibilityConfig {
  tradeOnlyOnce?: boolean;
  maxRebuyTimes?: number;
  cooldownMs?: number;
  blacklistedMints?: string[];
}

export class TokenLifecycleManager {
  private static instance: TokenLifecycleManager;

  // Separate, explicit collections for token states
  private tokenRecords: Map<string, TokenLifecycleRecord> = new Map();
  private seenTokens: Map<string, number> = new Map(); // mint -> discoveredAt
  private qualifiedTokens: Set<string> = new Set();
  private cooldowns: Map<string, number> = new Map(); // mint -> expiration timestamp
  private tradeCountPerMint: Map<string, number> = new Map(); // mint -> completed trades count
  private blacklistedMints: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): TokenLifecycleManager {
    if (!TokenLifecycleManager.instance) {
      TokenLifecycleManager.instance = new TokenLifecycleManager();
    }
    return TokenLifecycleManager.instance;
  }

  public getRecord(mint: string): TokenLifecycleRecord | undefined {
    return this.tokenRecords.get(mint.trim());
  }

  public getState(mint: string): TokenLifecycleState | 'UNSEEN' {
    const record = this.tokenRecords.get(mint.trim());
    return record ? record.state : 'UNSEEN';
  }

  public markDiscovered(mint: string, symbol: string = 'UNKNOWN'): TokenLifecycleRecord {
    const cleanMint = mint.trim();
    if (!cleanMint) throw new Error('Invalid mint');

    const now = Date.now();
    this.seenTokens.set(cleanMint, now);

    let record = this.tokenRecords.get(cleanMint);
    if (!record) {
      record = {
        mint: cleanMint,
        symbol,
        state: 'DISCOVERED',
        discoveredAt: now,
        lastStateChangeAt: now,
        completedTradesCount: this.tradeCountPerMint.get(cleanMint) || 0,
      };
      this.tokenRecords.set(cleanMint, record);

      systemLogger.info('PULSE_FEED', `[TOKEN_DISCOVERED] Token ${symbol} (${cleanMint.slice(0, 8)}...) observed in market feed`, {
        mint: cleanMint,
        symbol,
        eventType: 'TOKEN_DISCOVERED',
        status: 'DISCOVERED',
      });
    } else {
      if (symbol !== 'UNKNOWN' && record.symbol === 'UNKNOWN') {
        record.symbol = symbol;
      }
    }

    return record;
  }

  public markQualified(mint: string, symbol?: string): void {
    const cleanMint = mint.trim();
    const record = this.markDiscovered(cleanMint, symbol);
    record.state = 'QUALIFIED';
    record.lastStateChangeAt = Date.now();
    this.qualifiedTokens.add(cleanMint);

    systemLogger.info('STRATEGY', `[TOKEN_QUALIFIED] Token ${record.symbol} (${cleanMint.slice(0, 8)}...) passed hardened criteria filters`, {
      mint: cleanMint,
      symbol: record.symbol,
      eventType: 'TOKEN_QUALIFIED',
      status: 'QUALIFIED',
    });
  }

  public markRejected(mint: string, reason: string, symbol?: string): void {
    const cleanMint = mint.trim();
    const record = this.markDiscovered(cleanMint, symbol);
    record.state = 'REJECTED';
    record.rejectionReason = reason;
    record.lastStateChangeAt = Date.now();
    this.qualifiedTokens.delete(cleanMint);

    systemLogger.info('STRATEGY', `[TOKEN_REJECTED] Token ${record.symbol} (${cleanMint.slice(0, 8)}...) rejected: ${reason}`, {
      mint: cleanMint,
      symbol: record.symbol,
      eventType: 'TOKEN_REJECTED',
      status: 'REJECTED',
      reason,
    });
  }

  public markBuyRequested(mint: string): void {
    const cleanMint = mint.trim();
    const record = this.markDiscovered(cleanMint);
    record.state = 'BUY_REQUESTED';
    record.lastStateChangeAt = Date.now();

    systemLogger.info('BUY', `[BUY_REQUESTED] Buy order requested for ${record.symbol} (${cleanMint.slice(0, 8)}...)`, {
      mint: cleanMint,
      symbol: record.symbol,
      eventType: 'BUY_REQUESTED',
      status: 'BUY_REQUESTED',
    });
  }

  public markBuySubmitted(mint: string, orderId?: string): void {
    const cleanMint = mint.trim();
    const record = this.markDiscovered(cleanMint);
    record.state = 'BUY_SUBMITTED';
    record.lastStateChangeAt = Date.now();

    systemLogger.info('BUY', `[BUY_SUBMITTED] Buy order ${orderId || ''} submitted to network for ${record.symbol}`, {
      mint: cleanMint,
      symbol: record.symbol,
      eventType: 'BUY_SUBMITTED',
      status: 'BUY_SUBMITTED',
    });
  }

  public markBuyConfirmed(mint: string, signature?: string): void {
    const cleanMint = mint.trim();
    const record = this.markDiscovered(cleanMint);
    record.state = 'BUY_CONFIRMED';
    record.lastBuyAt = Date.now();
    record.lastStateChangeAt = Date.now();

    systemLogger.success('BUY', `[BUY_CONFIRMED] Buy transaction confirmed for ${record.symbol} (Sig: ${signature ? signature.slice(0, 8) + '...' : 'confirmed'})`, {
      mint: cleanMint,
      symbol: record.symbol,
      signature,
      eventType: 'BUY_CONFIRMED',
      status: 'BUY_CONFIRMED',
    });
  }

  public markPositionOpened(mint: string): void {
    const cleanMint = mint.trim();
    const record = this.markDiscovered(cleanMint);
    record.state = 'POSITION_OPEN';
    record.lastStateChangeAt = Date.now();

    systemLogger.success('POSITION', `[POSITION_OPENED] Active position established for ${record.symbol}`, {
      mint: cleanMint,
      symbol: record.symbol,
      eventType: 'POSITION_OPENED',
      status: 'POSITION_OPEN',
    });
  }

  public markSellRequested(mint: string, reason?: string): void {
    const cleanMint = mint.trim();
    const record = this.markDiscovered(cleanMint);
    record.state = 'SELL_REQUESTED';
    record.lastStateChangeAt = Date.now();

    systemLogger.info('SELL', `[SELL_REQUESTED] Exit requested for ${record.symbol} (Reason: ${reason || 'UNKNOWN'})`, {
      mint: cleanMint,
      symbol: record.symbol,
      reason,
      eventType: 'SELL_REQUESTED',
      status: 'SELL_REQUESTED',
    });
  }

  public markSellSubmitted(mint: string, orderId?: string): void {
    const cleanMint = mint.trim();
    const record = this.markDiscovered(cleanMint);
    record.state = 'SELL_SUBMITTED';
    record.lastStateChangeAt = Date.now();

    systemLogger.info('SELL', `[SELL_SUBMITTED] Sell order ${orderId || ''} submitted to network for ${record.symbol}`, {
      mint: cleanMint,
      symbol: record.symbol,
      eventType: 'SELL_SUBMITTED',
      status: 'SELL_SUBMITTED',
    });
  }

  public markSellConfirmed(mint: string, signature?: string): void {
    const cleanMint = mint.trim();
    const record = this.markDiscovered(cleanMint);
    record.state = 'SELL_CONFIRMED';
    record.lastSellAt = Date.now();
    record.lastStateChangeAt = Date.now();

    systemLogger.success('SELL', `[SELL_CONFIRMED] Sell transaction confirmed for ${record.symbol} (Sig: ${signature ? signature.slice(0, 8) + '...' : 'confirmed'})`, {
      mint: cleanMint,
      symbol: record.symbol,
      signature,
      eventType: 'SELL_CONFIRMED',
      status: 'SELL_CONFIRMED',
    });
  }

  public markPositionClosed(mint: string, outcome?: { pnlSol?: number; pnlPct?: number; cooldownMs?: number }): void {
    const cleanMint = mint.trim();
    const record = this.markDiscovered(cleanMint);
    record.state = 'POSITION_CLOSED';
    record.lastStateChangeAt = Date.now();

    // Increment completed trade counter
    const prevCount = this.tradeCountPerMint.get(cleanMint) || 0;
    const newCount = prevCount + 1;
    this.tradeCountPerMint.set(cleanMint, newCount);
    record.completedTradesCount = newCount;

    // Handle cooldown if specified
    if (outcome?.cooldownMs && outcome.cooldownMs > 0) {
      const cooldownUntil = Date.now() + outcome.cooldownMs;
      this.cooldowns.set(cleanMint, cooldownUntil);
      record.cooldownUntil = cooldownUntil;
    }

    // Handle blacklisting on loss if loss occurred
    if (outcome?.pnlPct !== undefined && outcome.pnlPct < -2.0) {
      this.blacklistedMints.add(cleanMint);
      systemLogger.warn('SAFETY', `[BLACKLISTED] Token ${record.symbol} (${cleanMint.slice(0, 8)}...) blacklisted due to realized loss (${outcome.pnlPct.toFixed(2)}%)`, {
        mint: cleanMint,
        symbol: record.symbol,
        reason: 'REALIZED_LOSS',
      });
    }

    systemLogger.success('POSITION', `[POSITION_CLOSED] Position closed for ${record.symbol}. Total completed trades: ${newCount}`, {
      mint: cleanMint,
      symbol: record.symbol,
      eventType: 'POSITION_CLOSED',
      status: 'POSITION_CLOSED',
      metadata: outcome,
    });
  }

  public setBlacklist(mints: string[]): void {
    this.blacklistedMints = new Set(mints.map(m => m.trim()));
  }

  public addBlacklist(mint: string): void {
    this.blacklistedMints.add(mint.trim());
  }

  public removeBlacklist(mint: string): void {
    this.blacklistedMints.delete(mint.trim());
  }

  public isBlacklisted(mint: string): boolean {
    return this.blacklistedMints.has(mint.trim());
  }

  /**
   * CAN TOKEN BE BOUGHT / REBOUGHT?
   * Evaluates canonical token states to prevent invalid rebuys without misidentifying
   * observed tokens as "already traded".
   */
  public canTokenBeBought(mint: string, config?: RebuyEligibilityConfig): { allowed: boolean; reason?: string; completedTrades: number } {
    const cleanMint = mint.trim();
    const completedTrades = this.tradeCountPerMint.get(cleanMint) || 0;

    // 1. Check Blacklist
    if (this.blacklistedMints.has(cleanMint) || config?.blacklistedMints?.includes(cleanMint)) {
      return { allowed: false, reason: 'TOKEN_BLACKLISTED', completedTrades };
    }

    // 2. Check Active Position
    const openPos = positionRegistry.getOpenPositionByMint(cleanMint);
    if (openPos) {
      return { allowed: false, reason: 'POSITION_ALREADY_OPEN', completedTrades };
    }

    // 3. Check Active Order Lock
    const activeOrder = orderManager.getActiveOrderForMint(cleanMint);
    if (activeOrder && ['SIGNAL', 'VALIDATING', 'QUOTE_REQUESTED', 'QUOTE_RECEIVED', 'TRANSACTION_BUILDING', 'SIGNING', 'SUBMITTED', 'CONFIRMING'].includes(activeOrder.state)) {
      return { allowed: false, reason: 'ORDER_IN_PROGRESS', completedTrades };
    }

    // 4. Check Cooldown
    const cooldownUntil = this.cooldowns.get(cleanMint);
    if (cooldownUntil && Date.now() < cooldownUntil) {
      const remainingSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
      return { allowed: false, reason: `COOLDOWN_ACTIVE_${remainingSec}S`, completedTrades };
    }

    // 5. Evaluate Rebuy Policies
    const tradeOnlyOnce = config?.tradeOnlyOnce ?? true;
    const maxRebuyTimes = Math.max(1, config?.maxRebuyTimes ?? 1);

    if (tradeOnlyOnce && completedTrades >= 1) {
      return { allowed: false, reason: 'TRADE_ONLY_ONCE_POLICY', completedTrades };
    }

    if (completedTrades >= maxRebuyTimes) {
      return { allowed: false, reason: 'MAX_REBUY_LIMIT_REACHED', completedTrades };
    }

    return { allowed: true, completedTrades };
  }

  public getCompletedTradeCount(mint: string): number {
    return this.tradeCountPerMint.get(mint.trim()) || 0;
  }
}

export const tokenLifecycleManager = TokenLifecycleManager.getInstance();
