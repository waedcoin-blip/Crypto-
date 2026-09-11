// server/execution/PaperTradeExecutor.ts
import {
  TradeExecutor,
  QuoteParams,
  QuoteResult,
  ExecuteParams,
  ExecutionResult,
} from './TradeExecutor.js';
import { paperWalletLedger } from '../wallet/PaperWalletLedger.js';
import { logger } from '../utils/logger.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export class PaperTradeExecutor implements TradeExecutor {
  public readonly network: string = 'paper';

  // ==========================================
  // QUOTE (Simulated)
  // ==========================================

  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    // Paper mode: simulate a quote with realistic slippage
    const amountNum = Number(params.amount);
    const simulatedSlippage = 1 + (params.slippageBps / 10000) * 0.5; // Half the requested slippage
    const outAmount = Math.floor(amountNum * simulatedSlippage);

    return {
      success: true,
      quote: {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inAmount: String(params.amount),
        outAmount: String(outAmount),
        routePlan: [{ swapInfo: { label: 'PaperSimulated' } }],
        priceImpactPct: 0.1,
      },
      outAmountLamports: outAmount,
      outAmountRaw: String(outAmount),
      priceImpactPct: 0.1,
      routePlanLength: 1,
    };
  }

  // ==========================================
  // BUY (Simulated)
  // ==========================================

  async buy(params: ExecuteParams): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const amountLamports = Number(params.amount);

      // Check paper balance
      const balance = paperWalletLedger.getSolBalance();
      if (balance < amountLamports / 1e9) {
        return {
          success: false,
          error: `INSUFFICIENT_BALANCE: Paper balance ${balance.toFixed(4)} SOL < required ${(amountLamports / 1e9).toFixed(4)} SOL`,
          durationMs: Date.now() - startTime,
        };
      }

      // Simulate execution delay (50-200ms)
      const simulatedDelay = 50 + Math.random() * 150;
      await new Promise(resolve => setTimeout(resolve, simulatedDelay));

      // Generate simulated signature
      const signature = `paper_buy_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      // Commit buy to paper wallet
      const tokenAmount = amountLamports; // Simplified: 1:1 for paper
      paperWalletLedger.commitBuy(params.outputMint, amountLamports / 1e9, tokenAmount, params.decimals || 9, signature);

      if (params.onBroadcast) {
        await params.onBroadcast(signature);
      }

      logger.info({ mint: params.outputMint, amountSol: amountLamports / 1e9, signature }, '[PaperTradeExecutor] BUY executed');

      return {
        success: true,
        signature,
        outAmountRaw: String(tokenAmount),
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `PAPER_BUY_ERROR: ${err?.message || String(err)}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ==========================================
  // SELL (Simulated)
  // ==========================================

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const tokenAmountRaw = BigInt(String(params.amount));

      // Check paper token balance
      const tokenBalance = paperWalletLedger.getTokenBalance(params.inputMint);
      if (BigInt(String(tokenBalance)) < tokenAmountRaw) {
        return {
          success: false,
          error: `INSUFFICIENT_TOKEN_BALANCE: Paper balance < sell amount`,
          durationMs: Date.now() - startTime,
        };
      }

      // Simulate execution delay
      const simulatedDelay = 50 + Math.random() * 150;
      await new Promise(resolve => setTimeout(resolve, simulatedDelay));

      // Generate simulated signature
      const signature = `paper_sell_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      // Add SOL to paper wallet (simulated output)
      const outSol = Number(tokenAmountRaw) / 1e9; // Simplified
      paperWalletLedger.commitSell(params.inputMint, outSol, tokenAmountRaw, params.decimals || 9, signature);

      if (params.onBroadcast) {
        await params.onBroadcast(signature);
      }

      logger.info({ mint: params.inputMint, amountRaw: String(tokenAmountRaw), signature }, '[PaperTradeExecutor] SELL executed');

      return {
        success: true,
        signature,
        outAmountLamports: Math.floor(outSol * 1e9),
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `PAPER_SELL_ERROR: ${err?.message || String(err)}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ==========================================
  // BALANCE QUERIES
  // ==========================================

  async getSolBalance(_walletAddress?: string): Promise<number> {
    return paperWalletLedger.getSolBalance();
  }

  async getTokenBalance(mint: string, _walletAddress?: string): Promise<number> {
    return paperWalletLedger.getTokenBalance(mint);
  }

  async verifyReadiness(): Promise<{ ready: boolean; reason?: string }> {
    return { ready: true }; // Paper mode is always ready
  }
}
