// server/execution/PaperTradeExecutor.ts
import { TradeExecutor, QuoteParams, QuoteResult, ExecuteParams, ExecutionResult } from './TradeExecutor.js';
import { positionManager } from '../trading/PositionManager.js';
import { paperWalletLedger } from '../wallet/PaperWalletLedger.js';

export class PaperTradeExecutor implements TradeExecutor {
  async quoteBuy(params: QuoteParams): Promise<QuoteResult> {
    const solAmount = params.amount / 1e9;
    const decs = params.decimals !== undefined ? params.decimals : 9;
    const simulatedTokensRaw = Math.floor(solAmount * 1_000_000 * (10 ** decs));
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
    const decs = params.decimals !== undefined ? params.decimals : 9;
    const tokenQty = params.amount / (10 ** decs);

    // Look up position's live/market price if available in Paper mode
    const pos = (positionManager.getOpenPositions(params.network, params.walletAddress) || [])
      .find(p => p.mint === params.inputMint)
      || positionManager.getPosition(params.network || 'paper', params.walletAddress || 'default', params.inputMint);

    const unitPrice = (pos && pos.currentPriceSol && pos.currentPriceSol > 0)
      ? pos.currentPriceSol
      : (pos && (pos as any).currentPriceSOL && (pos as any).currentPriceSOL > 0)
        ? (pos as any).currentPriceSOL
        : 0.000001; // 1M tokens = 1 SOL fallback

    const solProceeds = tokenQty * unitPrice;
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
      decimals: params.decimals,
      slippageBps: params.slippageBps,
    }));

    const solSpent = params.amount / 1e9;
    const currentSolBalance = paperWalletLedger.getSolBalance();
    if (currentSolBalance < solSpent) {
      return {
        success: false,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inAmountRaw: params.amount,
        outAmountRaw: 0,
        error: `INSUFFICIENT_PAPER_BALANCE: Required ${solSpent.toFixed(4)} SOL, available ${currentSolBalance.toFixed(4)} SOL`,
      };
    }

    const tokenReceivedRaw = Number(quote.outAmount);
    const signature = `paper_buy_${Date.now()}_${params.outputMint.slice(0, 8)}`;
    paperWalletLedger.commitBuy(params.outputMint, solSpent, tokenReceivedRaw, params.decimals, signature);

    const tokenQty = tokenReceivedRaw / (10 ** params.decimals);
    const effectivePrice = tokenQty > 0 ? solSpent / tokenQty : 0;

    return {
      success: true,
      signature,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmountRaw: params.amount,
      outAmountRaw: tokenReceivedRaw,
      totalCostSol: solSpent,
      effectivePriceSol: effectivePrice,
    };
  }

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    let currentTokenRaw = paperWalletLedger.getTokenBalance(params.inputMint);
    if (currentTokenRaw < params.amount) {
      currentTokenRaw = params.amount;
    }
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
      decimals: params.decimals,
      slippageBps: params.slippageBps,
    }));

    const solGainedLamports = Number(quote.outAmount);
    const solGained = solGainedLamports / 1e9;
    const signature = `paper_sell_${Date.now()}_${params.inputMint.slice(0, 8)}`;

    paperWalletLedger.commitSell(params.inputMint, solGained, sellAmountRaw, params.decimals, signature);

    return {
      success: true,
      signature,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmountRaw: sellAmountRaw,
      outAmountRaw: solGainedLamports,
      netProceedsSol: solGained,
    };
  }

  async getBalance(walletAddress?: string): Promise<number> {
    return paperWalletLedger.getSolBalance();
  }

  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {
    return paperWalletLedger.getTokenBalance(mint);
  }
}

