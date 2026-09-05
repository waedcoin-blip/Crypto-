// server/execution/PaperTradeExecutor.ts
import { TradeExecutor, QuoteParams, QuoteResult, ExecuteParams, ExecutionResult } from './TradeExecutor.js';
import { positionManager } from '../trading/PositionManager.js';
import { paperWalletLedger } from '../wallet/PaperWalletLedger.js';

export class PaperTradeExecutor implements TradeExecutor {
  private parseAmountBigInt(amount: bigint | string | number): bigint {
    if (typeof amount === 'bigint') return amount;
    const str = String(amount).trim();
    if (str.includes('.')) {
      throw new Error(`INVALID_RAW_AMOUNT: Floating point not allowed for raw token amount (${str})`);
    }
    return BigInt(str);
  }

  async quoteBuy(params: QuoteParams): Promise<QuoteResult> {
    const amountLamports = this.parseAmountBigInt(params.amount);
    const solAmount = Number(amountLamports) / 1e9;
    const decs = params.decimals !== undefined ? params.decimals : 9;
    const simulatedTokensRaw = BigInt(Math.floor(solAmount * 1_000_000 * (10 ** decs)));
    const slippage = params.slippageBps ? params.slippageBps / 10000 : 0.025;
    const minOutputRaw = BigInt(Math.floor(Number(simulatedTokensRaw) * (1 - slippage)));

    return {
      inAmount: amountLamports.toString(),
      outAmount: simulatedTokensRaw.toString(),
      otherAmountThreshold: minOutputRaw.toString(),
      priceImpactPct: 0.001,
      routePlan: [{ swapInfo: { ammKey: 'PaperSimulatedAMM' } }],
    };
  }

  async quoteSell(params: QuoteParams): Promise<QuoteResult> {
    // Input is raw token base units
    const amountRaw = this.parseAmountBigInt(params.amount);
    const decs = params.decimals !== undefined ? params.decimals : 9;
    const tokenQty = Number(amountRaw) / (10 ** decs);

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
    const lamports = BigInt(Math.floor(solProceeds * 1e9));
    const slippage = params.slippageBps ? params.slippageBps / 10000 : 0.025;
    const minLamports = BigInt(Math.floor(Number(lamports) * (1 - slippage)));

    return {
      inAmount: amountRaw.toString(),
      outAmount: lamports.toString(),
      otherAmountThreshold: minLamports.toString(),
      priceImpactPct: 0.001,
      routePlan: [{ swapInfo: { ammKey: 'PaperSimulatedAMM' } }],
    };
  }

  async buy(params: ExecuteParams): Promise<ExecutionResult> {
    const amountLamports = this.parseAmountBigInt(params.amount);
    const quote = params.preValidatedQuote || (await this.quoteBuy({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: amountLamports,
      decimals: params.decimals,
      slippageBps: params.slippageBps,
    }));

    const solSpent = Number(amountLamports) / 1e9;
    const currentSolBalance = paperWalletLedger.getSolBalance();
    if (currentSolBalance < solSpent) {
      return {
        success: false,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inAmountRaw: amountLamports.toString(),
        outAmountRaw: '0',
        error: `INSUFFICIENT_PAPER_BALANCE: Required ${solSpent.toFixed(4)} SOL, available ${currentSolBalance.toFixed(4)} SOL`,
      };
    }

    const tokenReceivedRaw = quote.outAmount;
    const signature = `paper_buy_${Date.now()}_${params.outputMint.slice(0, 8)}`;
    paperWalletLedger.commitBuy(params.outputMint, solSpent, Number(tokenReceivedRaw), params.decimals, signature);

    const tokenQty = Number(tokenReceivedRaw) / (10 ** params.decimals);
    const effectivePrice = tokenQty > 0 ? solSpent / tokenQty : 0;

    return {
      success: true,
      signature,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmountRaw: amountLamports.toString(),
      outAmountRaw: tokenReceivedRaw,
      totalCostSol: solSpent,
      effectivePriceSol: effectivePrice,
    };
  }

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    const amountRaw = this.parseAmountBigInt(params.amount);
    let currentTokenRaw = BigInt(paperWalletLedger.getTokenBalance(params.inputMint));
    if (currentTokenRaw < amountRaw) {
      currentTokenRaw = amountRaw;
    }
    const sellAmountRaw = amountRaw < currentTokenRaw ? amountRaw : currentTokenRaw;

    if (sellAmountRaw <= 0n) {
      return {
        success: false,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inAmountRaw: amountRaw.toString(),
        outAmountRaw: '0',
        error: `INSUFFICIENT_TOKEN_BALANCE: Available ${currentTokenRaw.toString()} raw base units`,
      };
    }

    const quote = params.preValidatedQuote || (await this.quoteSell({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: sellAmountRaw,
      decimals: params.decimals,
      slippageBps: params.slippageBps,
    }));

    const solGainedLamports = quote.outAmount;
    const solGained = Number(solGainedLamports) / 1e9;
    const signature = `paper_sell_${Date.now()}_${params.inputMint.slice(0, 8)}`;

    paperWalletLedger.commitSell(params.inputMint, solGained, Number(sellAmountRaw), params.decimals, signature);

    return {
      success: true,
      signature,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmountRaw: sellAmountRaw.toString(),
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

