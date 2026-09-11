// server/execution/FastExitExecutor.ts
import { Position, positionManager } from '../trading/PositionManager.js';
import { executionGateway } from './ExecutionGateway.js';
import { orderManager } from '../trading/OrderManager.js';
import { jupiterPreSellValidator } from '../services/JupiterPreSellValidator.js';
import { logger } from '../utils/logger.js';
import { lamportsToSolNumber } from '../utils/rawAmount.js';

export interface FastExitResult {
  success: boolean;
  signature?: string;
  error?: string;
  netProceedsSol?: number;
  preSellValidated?: boolean;
  attempts?: number;
}

export interface FastExitParams {
  position?: Position;
  positionId?: string;
  network?: string;
  wallet?: string;
  mint?: string;
  amountRaw?: string;
  slippageBps?: number;
  reason: string;
  clientRequestId?: string;
  preValidatedQuote?: any;
}

export class FastExitExecutor {
  private static instance: FastExitExecutor;
  private readonly MAX_RETRIES = 3;
  private readonly BASE_BACKOFF_MS = 500;

  private constructor() {}

  public static getInstance(): FastExitExecutor {
    if (!FastExitExecutor.instance) {
      FastExitExecutor.instance = new FastExitExecutor();
    }
    return FastExitExecutor.instance;
  }

  /**
   * Executes a full-position sell with pre-sell validation and retry logic.
   * This is the ONLY path for executing exits (TP, SL, Trailing, Manual).
   */
  public async executeSell(params: FastExitParams): Promise<FastExitResult> {
    const { reason, preValidatedQuote } = params;
    const startTime = Date.now();

    let position = params.position;
    if (!position && params.positionId) {
      position = positionManager.getPositionById(params.positionId);
    }
    if (!position && params.network && params.wallet && params.mint) {
      position = positionManager.getPosition(params.network, params.wallet, params.mint);
    }

    if (!position && params.mint) {
      // Fallback position representation from params
      position = {
        id: params.positionId || `pos_${params.mint}_${Date.now()}`,
        network: params.network || 'paper',
        wallet: params.wallet || 'default',
        mint: params.mint,
        side: 'buy',
        status: 'OPEN',
        entryPrice: 0,
        tokenAmount: 0,
        tokenAmountRaw: params.amountRaw || '0',
        decimals: 9,
        totalSolSpent: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
        peakPrice: 0,
        slippageBpsSl: params.slippageBps || 1000,
      } as unknown as Position;
    }

    if (!position) {
      return {
        success: false,
        error: 'POSITION_NOT_FOUND',
        preSellValidated: false,
      };
    }

    console.log(`[FastExitExecutor] EXIT INITIATED: mint=${position.mint} reason=${reason} positionId=${position.id}`);

    // 1. PRE-SELL VALIDATION (Jupiter Executable Quote)
    let validatedQuote = preValidatedQuote;
    if (!validatedQuote) {
      try {
        const rawAmount = position.tokenAmountRaw || params.amountRaw || String(Math.floor((position.tokenAmount || 0) * (10 ** (position.decimals || 9))));
        const preSellResult = await jupiterPreSellValidator.validatePreSell({
          inputMint: position.mint,
          outputMint: 'So11111111111111111111111111111111111111112', // WSOL
          rawAmount,
          slippageBps: position.slippageBpsSl || params.slippageBps || 1000,
          costBasisSol: position.totalSolSpent,
        });

        if (!preSellResult.isValid) {
          return {
            success: false,
            error: `PRE_SELL_VALIDATION_FAILED: ${preSellResult.reason}`,
            preSellValidated: false,
          };
        }

        validatedQuote = preSellResult.quote;
      } catch (err: any) {
        return {
          success: false,
          error: `PRE_SELL_VALIDATION_ERROR: ${err?.message || String(err)}`,
          preSellValidated: false,
        };
      }
    }

    // 2. CREATE ORDER
    const rawAmount = position.tokenAmountRaw || params.amountRaw || String(Math.floor((position.tokenAmount || 0) * (10 ** (position.decimals || 9))));
    const order = orderManager.createOrder({
      network: position.network,
      wallet: position.wallet,
      mint: position.mint,
      side: 'sell',
      amount: rawAmount,
      decimals: position.decimals || 9,
      slippageBps: position.slippageBpsSl || params.slippageBps || 1000,
      label: `exit_${reason.toLowerCase()}`,
      quote: validatedQuote,
      clientRequestId: params.clientRequestId,
    });

    // 3. EXECUTE WITH RETRY
    let lastError = '';
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`[FastExitExecutor] Sell attempt ${attempt}/${this.MAX_RETRIES} for ${position.mint}`);

        const execResult = await orderManager.executeOrder(order.id, validatedQuote);

        if (execResult.success) {
          const netProceedsSol = execResult.outAmountLamports ? execResult.outAmountLamports / 1e9 : 0;
          console.log(`[FastExitExecutor] SELL CONFIRMED: mint=${position.mint} signature=${execResult.signature} proceeds=${netProceedsSol.toFixed(6)} SOL duration=${Date.now() - startTime}ms`);

          return {
            success: true,
            signature: execResult.signature,
            netProceedsSol,
            preSellValidated: true,
            attempts: attempt,
          };
        } else {
          lastError = execResult.error || 'SELL_EXECUTION_FAILED';
          console.warn(`[FastExitExecutor] Sell attempt ${attempt} failed: ${lastError}`);
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
        console.error(`[FastExitExecutor] Sell attempt ${attempt} error:`, lastError);
      }

      // Exponential backoff before retry
      if (attempt < this.MAX_RETRIES) {
        const backoffMs = Math.min(this.BASE_BACKOFF_MS * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    // All retries exhausted
    return {
      success: false,
      error: `SELL_FAILED_AFTER_${this.MAX_RETRIES}_RETRIES: ${lastError}`,
      preSellValidated: true,
      attempts: this.MAX_RETRIES,
    };
  }
}

export const fastExitExecutor = FastExitExecutor.getInstance();
