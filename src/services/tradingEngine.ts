// src/services/tradingEngine.ts
// Unified Trading Engine for ARINA X-RAY
// Provides the single entry point for buy, sell, partial sell, and full sell operations.

import { SwapResult } from './ITradeExecutor';
import { orderManager } from './OrderManager';
import { executionEngine } from './ExecutionEngine';
import { positionRegistry } from './PositionRegistry';
import { tokenService } from './tokenService';
import { SOL_MINT } from '../constants/solana';
import { percentOfRawAmount } from '../utils/amounts';

export interface BuyRequest {
  mint: string;
  amountSol: number;
  slippageBps?: number;
  label?: string;
}

export interface SellRequest {
  mint: string;
  percent?: number;
  rawAmount?: bigint;
  reason?: string;
  slippageBps?: number;
}

class TradingEngine {
  /**
   * Execute a Buy order (SOL -> Token).
   */
  public async buy(request: BuyRequest): Promise<SwapResult> {
    const slippageBps = request.slippageBps || 100;
    const lamports = Math.floor(request.amountSol * 1_000_000_000);
    return orderManager.executeOrder(
      SOL_MINT,
      request.mint,
      lamports,
      slippageBps,
      request.label || 'entry'
    );
  }

  /**
   * Execute a Sell order (Token -> SOL).
   */
  public async sell(request: SellRequest): Promise<SwapResult> {
    const slippageBps = request.slippageBps || 150;
    const pos = positionRegistry.getPosition(request.mint);

    let rawAmountToSell: bigint;
    if (request.rawAmount && request.rawAmount > 0n) {
      rawAmountToSell = request.rawAmount;
    } else {
      const balance = pos?.amountRaw
        ? BigInt(pos.amountRaw)
        : (await tokenService.getTokenBalanceRaw(executionEngine.publicKey, request.mint)).raw;

      const percent = Math.min(100, Math.max(1, request.percent || 100));
      rawAmountToSell = percentOfRawAmount(balance, percent * 100);
    }

    if (rawAmountToSell <= 0n) {
      throw new Error(`INSUFFICIENT_TOKEN_BALANCE: Raw amount to sell for mint ${request.mint} is zero.`);
    }

    const strUnits = rawAmountToSell.toString();
    const numAmount = Number(strUnits);
    return orderManager.executeOrder(
      request.mint,
      SOL_MINT,
      numAmount,
      slippageBps,
      request.reason || 'MANUAL'
    );
  }

  /**
   * Partial sell helper (sell X% of current holdings).
   */
  public async partialSell(mint: string, percent: number, reason: string = 'PARTIAL_TRIM'): Promise<SwapResult> {
    return this.sell({ mint, percent, reason });
  }

  /**
   * Full sell helper (sell 100% of current holdings).
   */
  public async fullSell(mint: string, reason: string = 'FULL_EXIT'): Promise<SwapResult> {
    return this.sell({ mint, percent: 100, reason });
  }
}

export const tradingEngine = new TradingEngine();
