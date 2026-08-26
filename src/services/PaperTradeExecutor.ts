// src/services/PaperTradeExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { SOL_MINT, DEFAULT_PAPER_TRADING_ADDRESS } from '../constants/solana';
import { usePaperWalletStore } from '../store/paperWalletStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';

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
        if (data && data.outAmount) {
          return data as QuoteResponse;
        }
      }
    } catch (e) {
      console.warn('[PaperTradeExecutor] Jupiter quote fetch failed, using fallback calculation:', e);
    }

    // Fallback simulated quote calculation
    const isBuy = params.inputMint === SOL_MINT;
    const simulatedPriceInSol = 0.001; // Default fallback unit price
    const outAmount = isBuy
      ? Math.floor((inputAmount / (simulatedPriceInSol * 1e9)) * 1e6)
      : Math.floor(inputAmount * simulatedPriceInSol * 1000);

    return {
      inputMint: params.inputMint,
      inAmount: params.amount.toString(),
      outputMint: params.outputMint,
      outAmount: outAmount.toString(),
      otherAmountThreshold: Math.floor(outAmount * 0.99).toString(),
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
      // Amount is SOL (lamports)
      const solRequired = amount / 1e9;
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
          inputAmount: solRequired,
          outputAmount: 0,
          feeSol: simFee,
          slot: Math.floor(Date.now() / 400),
          landingTimeMs: Date.now() - startTime,
          method: 'rpc',
          simulated: true,
          error: errMsg,
        };
      }

      // Fetch quote for token quantity
      let tokenOutAmount = 0;
      try {
        const quote = await this.getQuote({
          inputMint,
          outputMint,
          amount: Math.round(amount),
          slippageBps,
        });
        tokenOutAmount = Number(quote.outAmount) / 1e6; // Default SPL 6 decimals
      } catch (e) {
        // Fallback calculation if quote fails
        tokenOutAmount = (solRequired / 0.001); // 1 SOL = 1000 tokens fallback
      }

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
        inputAmount: solRequired,
        outputAmount: tokenOutAmount,
        feeSol: simFee,
        slot: Math.floor(Date.now() / 400),
        landingTimeMs,
        method: 'rpc',
        simulated: true,
      };

    } else {
      // Selling token for SOL
      const tokenAmount = amount / 1e6; // SPL 6 decimals
      const currentTokenBal = paperStore.tokenBalances[inputMint] || 0;

      if (currentTokenBal < tokenAmount * 0.99) { // allow 1% floating point variance
        this.telemetryFailedSwaps++;
        const errMsg = `Insufficient Paper Token balance. Required: ${tokenAmount.toFixed(2)}, Available: ${currentTokenBal.toFixed(2)}.`;
        this.lastFailureReason = errMsg;
        return {
          signature: '',
          inputMint,
          outputMint,
          inputAmount: tokenAmount,
          outputAmount: 0,
          feeSol: 0,
          slot: Math.floor(Date.now() / 400),
          landingTimeMs: Date.now() - startTime,
          method: 'rpc',
          simulated: true,
          error: errMsg,
        };
      }

      let solOut = 0;
      try {
        const quote = await this.getQuote({
          inputMint,
          outputMint,
          amount: Math.round(amount),
          slippageBps,
        });
        solOut = Number(quote.outAmount) / 1e9;
      } catch (e) {
        solOut = tokenAmount * 0.001; // fallback
      }

      const simFee = 0.0005;
      const netSolReceived = Math.max(0, solOut - simFee);

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
        inputAmount: tokenAmount,
        outputAmount: netSolReceived,
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
