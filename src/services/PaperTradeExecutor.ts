// src/services/PaperTradeExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { SOL_MINT, DEFAULT_PAPER_TRADING_ADDRESS } from '../constants/solana';
import { usePaperWalletStore } from '../store/paperWalletStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { useAppStore } from '../store/appStore';
import { getSolPriceUsd } from '../utils/pnlCalculator';

async function resolveTokenPriceInSol(tokenMint: string): Promise<number> {
  // 1. Check AppStore state for tokenMetrics
  try {
    const store = useAppStore.getState();
    const metric = store?.tokenMetrics?.[tokenMint];
    if (metric) {
      if (typeof metric.priceNative === 'number' && metric.priceNative > 0) {
        return metric.priceNative;
      }
      if (typeof metric.priceNative === 'string' && parseFloat(metric.priceNative) > 0) {
        return parseFloat(metric.priceNative);
      }
      if (typeof metric.priceUsd === 'number' && metric.priceUsd > 0) {
        const solUsd = getSolPriceUsd() || 150;
        return metric.priceUsd / solUsd;
      }
    }
  } catch (e) {
    // Ignore store access error
  }

  // 2. Fetch directly from DexScreener API
  try {
    const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.pairs && data.pairs.length > 0) {
        const bestPair = data.pairs[0];
        if (bestPair.priceNative && parseFloat(bestPair.priceNative) > 0) {
          return parseFloat(bestPair.priceNative);
        }
        if (bestPair.priceUsd && parseFloat(bestPair.priceUsd) > 0) {
          return parseFloat(bestPair.priceUsd) / 150;
        }
      }
    }
  } catch (e) {
    // Ignore fetch error
  }

  // 3. Fallback for brand new tokens with no dex data yet (~0.0000003 SOL)
  return 0.0000003;
}

export class PaperTradeExecutor implements ITradeExecutor {
  readonly mode = 'paper' as const;

  private telemetryTotalSwaps = 0;
  private telemetryTotalFeesPaidSol = 0;
  private telemetryLandingTimeTotalMs = 0;
  private telemetryFailedSwaps = 0;
  private lastFailureReason?: string;

  public get publicKey(): string {
    return DEFAULT_PAPER_TRADING_ADDRESS;
  }

  private checkNetworkSafety(): void {
    const envNetwork = useTradingEnvironmentStore.getState().network;
    if (envNetwork !== 'paper') {
      throw new Error(`NETWORK SAFETY ERROR: Paper execution blocked because selected environment is '${envNetwork}'.`);
    }
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    const inputAmount = Number(params.amount || 0);
    
    // Try Jupiter API for mainnet price simulation if available
    try {
      const url = `https://quote-api.jup.ag/v6/quote?inputMint=${params.inputMint}&outputMint=${params.outputMint}&amount=${inputAmount}&slippageBps=${params.slippageBps || 50}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.outAmount && Number(data.outAmount) > 0) {
          return data as QuoteResponse;
        }
      }
    } catch (e) {
      console.warn('[PaperTradeExecutor] Jupiter quote fetch failed, using fallback calculation:', e);
    }

    // Fallback simulated quote calculation using real token price in SOL
    const isBuy = params.inputMint === SOL_MINT;
    const targetTokenMint = isBuy ? params.outputMint : params.inputMint;
    const simulatedPriceInSol = await resolveTokenPriceInSol(targetTokenMint); 
    let outAmountRaw = 0;

    if (isBuy) {
      // inputAmount is SOL lamports (1e9 per SOL).
      const solAmount = inputAmount / 1e9;
      const tokensCount = solAmount / (simulatedPriceInSol > 0 ? simulatedPriceInSol : 0.0000003);
      outAmountRaw = Math.floor(tokensCount * 1e6); // 6 decimals for token
    } else {
      // inputAmount is token raw units (1e6 per token).
      const tokensCount = inputAmount / 1e6;
      const solAmount = tokensCount * simulatedPriceInSol;
      outAmountRaw = Math.floor(solAmount * 1e9); // 9 decimals for SOL lamports
    }

    return {
      inputMint: params.inputMint,
      inAmount: params.amount.toString(),
      outputMint: params.outputMint,
      outAmount: outAmountRaw.toString(),
      otherAmountThreshold: Math.floor(outAmountRaw * 0.99).toString(),
      swapMode: 'ExactIn',
      slippageBps: params.slippageBps || 50,
      priceImpactPct: '0.05',
      routePlan: [],
    } as unknown as QuoteResponse;
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry'
  ): Promise<SwapResult> {
    const startTime = Date.now();
    this.checkNetworkSafety();

    const paperStore = usePaperWalletStore.getState();
    const isBuy = inputMint === SOL_MINT;

    if (isBuy) {
      // Amount is SOL in lamports (if passed as SOL float < 100, convert to lamports)
      const inputLamports = amount < 1000 ? Math.floor(amount * 1e9) : Math.floor(amount);
      const solRequired = inputLamports / 1e9;
      const simFee = 0.0005; // 0.0005 SOL simulated transaction fee
      const totalSolNeeded = solRequired + simFee;

      if (paperStore.solBalance < totalSolNeeded) {
        this.telemetryFailedSwaps++;
        const errMsg = `Insufficient Paper SOL balance. Required: ${totalSolNeeded.toFixed(4)} SOL, Available: ${paperStore.solBalance.toFixed(4)} SOL.`;
        this.lastFailureReason = errMsg;
        return {
          signature: '',
          inputMint,
          outputMint,
          inputAmount: inputLamports,
          outputAmount: 0,
          feeSol: simFee,
          slot: Math.floor(Date.now() / 400),
          landingTimeMs: Date.now() - startTime,
          method: 'rpc',
          simulated: true,
          error: errMsg,
        };
      }

      // Fetch quote for token quantity (returns raw units in quote.outAmount)
      let rawTokenOut = 0;
      try {
        const quote = await this.getQuote({
          inputMint,
          outputMint,
          amount: inputLamports,
          slippageBps,
        });
        rawTokenOut = Number(quote.outAmount) || 0;
      } catch (e) {
        console.warn('[PaperTradeExecutor] Quote error, fallback:', e);
      }

      if (rawTokenOut <= 0) {
        const simPrice = await resolveTokenPriceInSol(outputMint);
        rawTokenOut = Math.floor((solRequired / (simPrice > 0 ? simPrice : 0.0000003)) * 1e6);
      }

      const tokenOutAmount = rawTokenOut / 1e6; // Human-readable token amount for paper store

      // Execute Paper Buy
      paperStore.adjustSolBalance(-totalSolNeeded);
      paperStore.adjustTokenBalance(outputMint, tokenOutAmount);

      this.telemetryTotalSwaps++;
      this.telemetryTotalFeesPaidSol += simFee;
      const landingTimeMs = Date.now() - startTime;
      this.telemetryLandingTimeTotalMs += landingTimeMs;

      const txHash = `paper_buy_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      return {
        signature: txHash,
        inputMint,
        outputMint,
        inputAmount: inputLamports,
        outputAmount: rawTokenOut, // Raw atomic token units
        feeSol: simFee,
        slot: Math.floor(Date.now() / 400),
        landingTimeMs,
        method: 'rpc',
        simulated: true,
      };

    } else {
      // Selling token for SOL
      // amount is raw token units or human amount if < 1,000,000
      const rawInputTokens = amount < 1e6 ? Math.floor(amount * 1e6) : Math.floor(amount);
      const tokenAmount = rawInputTokens / 1e6; // Human readable
      const currentTokenBal = paperStore.tokenBalances[inputMint] || 0;

      if (currentTokenBal < tokenAmount * 0.99) { // allow 1% floating point variance
        this.telemetryFailedSwaps++;
        const errMsg = `Insufficient Paper Token balance. Required: ${tokenAmount.toFixed(2)}, Available: ${currentTokenBal.toFixed(2)}.`;
        this.lastFailureReason = errMsg;
        return {
          signature: '',
          inputMint,
          outputMint,
          inputAmount: rawInputTokens,
          outputAmount: 0,
          feeSol: 0,
          slot: Math.floor(Date.now() / 400),
          landingTimeMs: Date.now() - startTime,
          method: 'rpc',
          simulated: true,
          error: errMsg,
        };
      }

      let rawSolOutLamports = 0;
      try {
        const quote = await this.getQuote({
          inputMint,
          outputMint,
          amount: rawInputTokens,
          slippageBps,
        });
        rawSolOutLamports = Number(quote.outAmount) || 0;
      } catch (e) {
        console.warn('[PaperTradeExecutor] Quote error on sell, fallback:', e);
      }

      if (rawSolOutLamports <= 0) {
        const simPrice = await resolveTokenPriceInSol(inputMint);
        rawSolOutLamports = Math.floor((tokenAmount * simPrice) * 1e9);
      }

      const solOut = rawSolOutLamports / 1e9;
      const simFee = 0.0005;
      const netSolReceived = Math.max(0, solOut - simFee);
      const netSolLamports = Math.floor(netSolReceived * 1e9);

      // Execute Paper Sell
      paperStore.adjustTokenBalance(inputMint, -tokenAmount);
      paperStore.adjustSolBalance(netSolReceived);

      this.telemetryTotalSwaps++;
      this.telemetryTotalFeesPaidSol += simFee;
      const landingTimeMs = Date.now() - startTime;
      this.telemetryLandingTimeTotalMs += landingTimeMs;

      const txHash = `paper_sell_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      return {
        signature: txHash,
        inputMint,
        outputMint,
        inputAmount: rawInputTokens,
        outputAmount: netSolLamports, // Raw SOL lamports
        feeSol: simFee,
        slot: Math.floor(Date.now() / 400),
        landingTimeMs,
        method: 'rpc',
        simulated: true,
      };
    }
  }

  async batchSwap(
    swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number }>
  ): Promise<SwapResult[]> {
    const results: SwapResult[] = [];
    for (const s of swaps) {
      const res = await this.swap(s.inputMint, s.outputMint, s.amount, s.slippageBps);
      results.push(res);
    }
    return results;
  }

  async getSolBalance(): Promise<number> {
    return usePaperWalletStore.getState().solBalance;
  }

  async getTokenBalance(mint: string): Promise<number> {
    return usePaperWalletStore.getState().tokenBalances[mint] || 0;
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    return (usePaperWalletStore.getState().tokenBalances[mint] || 0) > 0;
  }

  getTelemetry(): ExecutorTelemetry {
    const totalAttempted = this.telemetryTotalSwaps + this.telemetryFailedSwaps;
    return {
      totalSwaps: this.telemetryTotalSwaps,
      totalFeesPaidSol: this.telemetryTotalFeesPaidSol,
      avgLandingTimeMs: this.telemetryTotalSwaps > 0 ? this.telemetryLandingTimeTotalMs / this.telemetryTotalSwaps : 0,
      failureRate: totalAttempted > 0 ? this.telemetryFailedSwaps / totalAttempted : 0,
      lastFailure: this.lastFailureReason,
    };
  }
}
