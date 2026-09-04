// server/execution/FastExitExecutor.ts
import { orderManager } from '../trading/OrderManager.js';
import { positionManager } from '../trading/PositionManager.js';
import { tradeRepository } from '../repositories/TradeRepository.js';
import { ExecutionResult } from './TradeExecutor.js';

export interface FastExitParams {
  positionId: string;
  network: string;
  wallet: string;
  mint: string;
  amountRaw: number; // legacy execution API; must be a safe integer
  slippageBps: number;
  reason: string;
  clientRequestId: string;
}

export class FastExitExecutor {
  private static instance: FastExitExecutor;

  private constructor() {}

  public static getInstance(): FastExitExecutor {
    if (!FastExitExecutor.instance) {
      FastExitExecutor.instance = new FastExitExecutor();
    }
    return FastExitExecutor.instance;
  }

  /**
   * Performs high-speed pure execution of an authorized exit command.
   */
  public async executeSell(params: FastExitParams): Promise<ExecutionResult> {
    const position = positionManager.getPositionById(params.positionId);
    if (!position) {
      return {
        success: false,
        error: `POSITION_NOT_FOUND: No active position with ID ${params.positionId}`,
        inputMint: params.mint,
        outputMint: 'So11111111111111111111111111111111111111112',
        inAmountRaw: params.amountRaw,
        outAmountRaw: 0,
      };
    }

    if (!Number.isSafeInteger(params.amountRaw) || params.amountRaw <= 0) {
      return { success: false, error: 'INVALID_RAW_AMOUNT: Refusing to execute an unsafe/non-positive raw token amount.', inputMint: params.mint, outputMint: 'So11111111111111111111111111111111111111112', inAmountRaw: params.amountRaw, outAmountRaw: 0 };
    }

    // 1. Create Sell Order in OrderManager
    const order = orderManager.createOrder({
      network: params.network,
      wallet: params.wallet,
      mint: params.mint,
      side: 'sell',
      amount: params.amountRaw,
      decimals: position.decimals,
      slippageBps: params.slippageBps,
      clientRequestId: params.clientRequestId,
      label: params.reason || 'FAST_EXIT',
    });

    console.log(`[FastExitExecutor] Created sell order=${order.id} for position=${params.positionId} mint=${params.mint}`);

    // 2. Execute Order via standard orderManager
    try {
      const execResult = await orderManager.executeOrder(order.id);

      if (!execResult.success) {
        if (execResult.isAmbiguous || execResult.signature || execResult.status === 'RECOVERY_REQUIRED') {
          console.warn(`[FastExitExecutor] Sell transaction broadcasted or timed out. Status: ${execResult.status}`);
        }
        return execResult;
      }

      // 3. Record confirmed trade in tradeRepository
      tradeRepository.recordTrade({
        id: `trade_${order.id}`,
        orderId: order.id,
        positionId: position.id,
        mintAddress: params.mint,
        side: 'SELL',
        network: params.network,
        wallet: params.wallet,
        amountRaw: params.amountRaw,
        amountTokens: params.amountRaw / (10 ** position.decimals),
        solAmount: execResult.netProceedsSol || 0,
        priceSOL: execResult.effectivePriceSol || 0,
        pnlSol: execResult.netProceedsSol !== undefined ? execResult.netProceedsSol - position.totalSolSpent : undefined,
        signature: execResult.signature || order.id,
        timestamp: Date.now(),
        status: 'CONFIRMED',
      });

      console.log(`[FastExitExecutor] Successfully executed on-chain sell for ${params.mint} with signature: ${execResult.signature}`);
      return execResult;
    } catch (err: any) {
      console.error(`[FastExitExecutor] Error executing order ${order.id}:`, err);
      return {
        success: false,
        error: err.message || String(err),
        inputMint: params.mint,
        outputMint: 'So11111111111111111111111111111111111111112',
        inAmountRaw: params.amountRaw,
        outAmountRaw: 0,
      };
    }
  }
}

export const fastExitExecutor = FastExitExecutor.getInstance();
