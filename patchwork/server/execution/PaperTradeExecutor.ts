// server/execution/PaperTradeExecutor.ts
import { TradeExecutor, QuoteParams, QuoteResult, ExecuteParams, ExecutionResult } from './TradeExecutor.js';

export class PaperTradeExecutor implements TradeExecutor {
  private paperSolBalance = 100.0; // 100 SOL simulated balance
  private paperTokenBalances: Map<string, number> = new Map(); // mint -> raw integer units

  async quoteBuy(params: QuoteParams): Promise<QuoteResult> {
    const solAmount = params.amount / 1e9;
    // Simulated token price: e.g. 1 SOL = 1,000,000 tokens (6 decimals = 10^12 base units)
    const simulatedTokensRaw = Math.floor(solAmount * 1_000_000 * 1e6);
    const slippage = params.slippageBps ? params.slippageBps / 10000 : 0.025;
    const minOutputRaw = Math.floor(simulatedTokensRaw * (1 - slippage));

    return {
      inAmount: String(params.amount),
      outAmount: String(simulatedTokensRaw),
      otherAmountThreshold: String(minOutputRaw),
      priceImpactPct: 0.001,
      routePlan: [{ swapInfo: { ammKey: 'PaperSimulatedAMM' } }],
    };
  }

  async quoteSell(params: QuoteParams): Promise<QuoteResult> {
    // Input is raw token base units
    const tokenQty = params.amount / 1e6;
    const solProceeds = tokenQty * 0.000001; // 1M tokens = 1 SOL
    const lamports = Math.floor(solProceeds * 1e9);
    const slippage = params.slippageBps ? params.slippageBps / 10000 : 0.025;
    const minLamports = Math.floor(lamports * (1 - slippage));

    return {
      inAmount: String(params.amount),
      outAmount: String(lamports),
      otherAmountThreshold: String(minLamports),
      priceImpactPct: 0.001,
      routePlan: [{ swapInfo: { ammKey: 'PaperSimulatedAMM' } }],
    };
  }

  async buy(params: ExecuteParams): Promise<ExecutionResult> {
    const quote = params.preValidatedQuote || (await this.quoteBuy({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps,
    }));

    const solSpent = params.amount / 1e9;
    if (this.paperSolBalance < solSpent) {
      return {
        success: false,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inAmountRaw: params.amount,
        outAmountRaw: 0,
        error: `INSUFFICIENT_PAPER_BALANCE: Required ${solSpent.toFixed(4)} SOL, available ${this.paperSolBalance.toFixed(4)} SOL`,
      };
    }

    const tokenReceivedRaw = Number(quote.outAmount);
    this.paperSolBalance -= solSpent;
    const existingToken = this.paperTokenBalances.get(params.outputMint) || 0;
    this.paperTokenBalances.set(params.outputMint, existingToken + tokenReceivedRaw);

    const tokenQty = tokenReceivedRaw / 1e6;
    const effectivePrice = tokenQty > 0 ? solSpent / tokenQty : 0;

    return {
      success: true,
      signature: `paper_buy_${Date.now()}_${params.outputMint.slice(0, 8)}`,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmountRaw: params.amount,
      outAmountRaw: tokenReceivedRaw,
      totalCostSol: solSpent,
      effectivePriceSol: effectivePrice,
      outputDecimals: params.tokenDecimals ?? 6,
    };
  }

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    const currentTokenRaw = this.paperTokenBalances.get(params.inputMint) || 0;
    const sellAmountRaw = Math.min(params.amount, currentTokenRaw);

    if (sellAmountRaw <= 0) {
      return {
        success: false,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inAmountRaw: params.amount,
        outAmountRaw: 0,
        error: `INSUFFICIENT_TOKEN_BALANCE: Available ${currentTokenRaw} raw base units`,
      };
    }

    const quote = params.preValidatedQuote || (await this.quoteSell({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: sellAmountRaw,
      slippageBps: params.slippageBps,
    }));

    const solGainedLamports = Number(quote.outAmount);
    const solGained = solGainedLamports / 1e9;

    this.paperTokenBalances.set(params.inputMint, currentTokenRaw - sellAmountRaw);
    this.paperSolBalance += solGained;

    return {
      success: true,
      signature: `paper_sell_${Date.now()}_${params.inputMint.slice(0, 8)}`,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmountRaw: sellAmountRaw,
      outAmountRaw: solGainedLamports,
      netProceedsSol: solGained,
    };
  }

  async getBalance(walletAddress?: string): Promise<number> {
    return this.paperSolBalance;
  }

  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {
    return this.paperTokenBalances.get(mint) || 0;
  }
}
