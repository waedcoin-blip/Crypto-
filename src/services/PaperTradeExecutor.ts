// src/services/PaperTradeExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { SOL_MINT, DEFAULT_PAPER_TRADING_ADDRESS } from '../constants/solana';
import { usePaperWalletStore } from '../store/paperWalletStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { useAppStore } from '../store/appStore';
import { tokenRegistry } from './TokenRegistry';

export function resolveTokenDecimals(tokenMint: string): number {
  if (tokenMint === SOL_MINT || tokenMint === 'So11111111111111111111111111111111111111112') return 9;
  const regToken = tokenRegistry.getToken(tokenMint);
  if (regToken?.decimals !== undefined && typeof regToken.decimals === 'number') return regToken.decimals;
  const metric = useAppStore.getState()?.tokenMetrics?.[tokenMint] as any;
  if (metric?.decimals !== undefined && typeof metric.decimals === 'number') return metric.decimals;
  throw new Error(`UNRESOLVED_TOKEN_DECIMALS: Cannot resolve mint decimals for ${tokenMint}. Order execution blocked to prevent balance corruption.`);
}

export async function resolveTokenDecimalsAsync(tokenMint: string): Promise<number> {
  if (tokenMint === SOL_MINT || tokenMint === 'So11111111111111111111111111111111111111112') return 9;
  
  try {
    return resolveTokenDecimals(tokenMint);
  } catch (err) {
    // Attempt DexScreener lookup to dynamically discover token decimals
    try {
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.pairs && data.pairs.length > 0) {
          const pair = data.pairs[0];
          // Try to discover decimals from token metadata or pair
          const baseDecimals = pair.baseToken?.mint === tokenMint ? pair.baseToken?.decimals : pair.quoteToken?.decimals;
          if (typeof baseDecimals === 'number') {
            tokenRegistry.registerOrUpdate({
              mintAddress: tokenMint,
              decimals: baseDecimals,
              symbol: pair.baseToken?.symbol
            });
            return baseDecimals;
          }
        }
      }
    } catch (fetchErr) {
      console.warn(`[PaperTradeExecutor] DexScreener decimal lookup failed for ${tokenMint}:`, fetchErr);
    }
    
    throw new Error(`UNRESOLVED_TOKEN_DECIMALS: Failed to fetch mint decimals for ${tokenMint}. Trade execution aborted.`);
  }
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
    const slippageBps = Math.max(0, Math.min(5000, Number(params.slippageBps || 50)));

    // Real Jupiter market quote ONLY. No synthetic fallback permitted.
    try {
      const url = `https://quote-api.jup.ag/v6/quote?inputMint=${params.inputMint}&outputMint=${params.outputMint}&amount=${inputAmount}&slippageBps=${slippageBps}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.outAmount && Number(data.outAmount) > 0) {
          return data as QuoteResponse;
        }
      }
    } catch (e: any) {
      console.warn('[PaperTradeExecutor] Jupiter market quote fetch failed:', e);
    }

    throw new Error(`PAPER_QUOTE_FAILED: Unable to fetch real Jupiter market quote for ${params.inputMint} -> ${params.outputMint}. Real market liquidity required.`);
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
    const isBuy = inputMint === SOL_MINT || inputMint === 'So11111111111111111111111111111111111111112';

    if (isBuy) {
      // Input is SOL in lamports
      const inputLamports = amount < 1000 ? Math.floor(amount * 1e9) : Math.floor(amount);
      const solRequired = inputLamports / 1e9;
      const simFee = 0.0005; // 0.0005 SOL simulated transaction fee
      const totalSolNeeded = solRequired + simFee;

      if (paperStore.solBalance < totalSolNeeded) {
        this.telemetryFailedSwaps++;
        const errMsg = `INSUFFICIENT_FUNDS: Required ${totalSolNeeded.toFixed(4)} SOL, Available ${paperStore.solBalance.toFixed(4)} SOL.`;
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

      // Initial quote
      await this.getQuote({ inputMint, outputMint, amount: inputLamports, slippageBps });

      // 150ms simulated execution latency delay
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Fresh quote at execution time
      const freshQuote = await this.getQuote({ inputMint, outputMint, amount: inputLamports, slippageBps });
      const rawTokenOut = Number(freshQuote.outAmount) || 0;

      if (rawTokenOut <= 0) {
        this.telemetryFailedSwaps++;
        const errMsg = 'Paper swap failed: Invalid output token amount returned by quote.';
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

      const outDecimals = await resolveTokenDecimalsAsync(outputMint);
      const tokenOutAmount = rawTokenOut / Math.pow(10, outDecimals);

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
        outputAmount: rawTokenOut,
        feeSol: simFee,
        slot: Math.floor(Date.now() / 400),
        landingTimeMs,
        method: 'rpc',
        simulated: true,
      };
    } else {
      // Selling token for SOL
      const inDecimals = await resolveTokenDecimalsAsync(inputMint);
      const rawInputTokens = amount < Math.pow(10, inDecimals) ? Math.floor(amount * Math.pow(10, inDecimals)) : Math.floor(amount);
      const tokenAmount = rawInputTokens / Math.pow(10, inDecimals);
      const currentTokenBal = paperStore.tokenBalances[inputMint] || 0;

      if (currentTokenBal < tokenAmount * 0.99) {
        this.telemetryFailedSwaps++;
        const errMsg = `INSUFFICIENT_FUNDS: Required ${tokenAmount.toFixed(4)} tokens, Available ${currentTokenBal.toFixed(4)}.`;
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

      // Initial quote
      await this.getQuote({ inputMint, outputMint, amount: rawInputTokens, slippageBps });

      // 150ms simulated execution latency delay
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Fresh quote at execution time
      const freshQuote = await this.getQuote({ inputMint, outputMint, amount: rawInputTokens, slippageBps });
      const rawSolOutLamports = Number(freshQuote.outAmount) || 0;

      if (rawSolOutLamports <= 0) {
        this.telemetryFailedSwaps++;
        const errMsg = 'Paper swap failed: Invalid SOL output returned by quote.';
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

      const solOut = rawSolOutLamports / 1e9;
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
        inputAmount: rawInputTokens,
        outputAmount: rawSolOutLamports, // Gross output lamports (fee is separate in feeSol)
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

