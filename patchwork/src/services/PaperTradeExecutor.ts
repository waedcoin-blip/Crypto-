// src/services/PaperTradeExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry, ExecutionError, ExecutionFailureClassification } from './ITradeExecutor';
import { JupiterTransactionReplay, classifyExecutionError } from './JupiterTransactionReplay';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { SOL_MINT, DEFAULT_PAPER_TRADING_ADDRESS } from '../constants/solana';
import { usePaperWalletStore } from '../store/paperWalletStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { useAppStore } from '../store/appStore';
import {
  getSolPriceUsd,
  getDynamicOperationalFeeSol,
  ATA_RENT_EXEMPTION_SOL,
} from '../utils/pnlCalculator';
import { tokenRegistry } from './TokenRegistry';
import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig } from '../config/network';
import { getJupiterQuote } from './jupiterService';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

function isSolMint(mint: string): boolean {
  return mint === SOL_MINT || mint === WSOL_MINT;
}

function isPumpMint(mint: string): boolean {
  return typeof mint === 'string' && mint.trim().toLowerCase().endsWith('pump');
}

export function resolveTokenDecimals(tokenMint: string): number {
  const cleanMint = (tokenMint || '').trim();
  if (!cleanMint) throw new Error('UNRESOLVED_TOKEN_DECIMALS: token mint is required');
  if (isSolMint(cleanMint)) return 9;
  const regToken = tokenRegistry.getToken(cleanMint);
  if (regToken?.decimals !== undefined && typeof regToken.decimals === 'number') return regToken.decimals;
  const metric = useAppStore.getState()?.tokenMetrics?.[cleanMint] as any;
  if (metric?.decimals !== undefined && typeof metric.decimals === 'number') return metric.decimals;
  throw new Error(`UNRESOLVED_TOKEN_DECIMALS: Unable to resolve token decimals for mint ${cleanMint}`);
}

export async function resolveTokenDecimalsAsync(tokenMint: string): Promise<number> {
  const cleanMint = (tokenMint || '').trim();
  if (!cleanMint) throw new Error('UNRESOLVED_TOKEN_DECIMALS: token mint is required');
  if (isSolMint(cleanMint)) return 9;
  
  // 1. Check registry & app store
  const regToken = tokenRegistry.getToken(cleanMint);
  if (regToken?.decimals !== undefined && typeof regToken.decimals === 'number' && regToken.decimals >= 0) {
    return regToken.decimals;
  }
  const metric = useAppStore.getState()?.tokenMetrics?.[cleanMint] as any;
  if (metric?.decimals !== undefined && typeof metric.decimals === 'number' && metric.decimals >= 0) {
    tokenRegistry.registerOrUpdate({ mintAddress: cleanMint, decimals: metric.decimals });
    return metric.decimals;
  }

  // 2. Query Solana RPC on-chain parsed account info
  try {
    const net = useTradingEnvironmentStore.getState().network || 'paper';
    const cfg = getNetworkConfig(net);
    const connection = new Connection(cfg.rpcUrl, 'confirmed');
    const info = await connection.getParsedAccountInfo(new PublicKey(cleanMint));
    if (info?.value?.data && typeof info.value.data === 'object' && 'parsed' in info.value.data) {
      const decimals = info.value.data.parsed?.info?.decimals;
      if (typeof decimals === 'number' && decimals >= 0 && decimals <= 18) {
        tokenRegistry.registerOrUpdate({ mintAddress: cleanMint, decimals });
        return decimals;
      }
    }
  } catch (rpcErr) {
    console.warn(`[PaperTradeExecutor] RPC decimal lookup skipped for ${cleanMint}:`, rpcErr);
  }

  // 3. Query Jupiter Token API
  try {
    const res = await fetch(`https://tokens.jup.ag/token/${cleanMint}`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.decimals === 'number' && data.decimals >= 0 && data.decimals <= 18) {
        tokenRegistry.registerOrUpdate({
          mintAddress: cleanMint,
          decimals: data.decimals,
          symbol: data.symbol || 'UNKNOWN',
        });
        return data.decimals;
      }
    }
  } catch (jupErr) {
    // ignore
  }

  // 4. Unknown decimals hard failure
  throw new Error(`UNRESOLVED_TOKEN_DECIMALS: Unable to resolve token decimals for mint ${cleanMint}. Execution rejected to prevent quantity corruption.`);
}

export async function resolveTokenPriceInSol(tokenMint: string): Promise<number | null> {
  if (isSolMint(tokenMint)) return 1;

  // 1. Query Jupiter Price API (Source-of-truth price feed)
  try {
    const customApiKey = localStorage.getItem('jupiter_auto_apiKey') || localStorage.getItem('juipter_auto_apiKey') || '';
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (customApiKey && !customApiKey.startsWith('http')) {
      headers['x-api-key'] = customApiKey;
    }

    const priceRes = await fetch(`/api/jup/price?ids=${tokenMint}&vsToken=${WSOL_MINT}`, { headers });
    if (priceRes.ok) {
      const priceJson = await priceRes.json();
      const entry = priceJson?.data?.[tokenMint];
      if (entry && typeof entry.price === 'number' && entry.price > 0) {
        return entry.price;
      }
      if (entry && typeof entry.price === 'string' && parseFloat(entry.price) > 0) {
        return parseFloat(entry.price);
      }
    }
  } catch (e) {
    // Ignore and fallback to Jupiter quote
  }

  // 2. Query Jupiter Quote API directly (1 whole token test quote)
  try {
    const decimals = tokenRegistry.get(tokenMint)?.decimals;
    if (decimals === undefined) throw new Error(`UNRESOLVED_TOKEN_DECIMALS: ${tokenMint}`);
    const testAmount = Math.floor(10 ** decimals);
    const quote = await getJupiterQuote(tokenMint, WSOL_MINT, testAmount);
    if (quote && quote.outAmount) {
      const solOut = Number(quote.outAmount) / 1e9;
      if (solOut > 0) {
        return solOut;
      }
    }
  } catch (e) {
    // Quote failed
  }

  return null;
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

  private validateQuoteSafety(quote: QuoteResponse, inputAmount: number, slippageBps: number): void {
    JupiterTransactionReplay.validateInitialQuote({
      quote,
      inputAmount,
      slippageBps,
      maxPriceImpactPct: 10.0,
    });
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    const inputAmount = Number(params.amount || 0);
    const slippageBps = Number(params.slippageBps ?? 50);

    if (inputAmount <= 0 || !Number.isFinite(inputAmount)) {
      throw new Error(`INVALID_QUOTE_REQUEST: Amount must be a positive integer in base units (got: ${params.amount})`);
    }

    if (slippageBps > 1000) {
      throw new Error(`EXCESSIVE_SLIPPAGE: Slippage BPS ${slippageBps} exceeds maximum allowable limit of 1000 (10%).`);
    }

    // 1. Try Jupiter internal proxy first (handles CORS, fallbacks, and rate-limits)
    try {
      const proxyUrl = `/api/jup/quote?inputMint=${params.inputMint}&outputMint=${params.outputMint}&amount=${inputAmount}&slippageBps=${slippageBps}`;
      const resp = await fetch(proxyUrl);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.outAmount && Number(data.outAmount) > 0 && Array.isArray(data.routePlan) && data.routePlan.length > 0) {
          return data as QuoteResponse;
        }
      }
    } catch (e: any) {
      // Continue to direct fallbacks
    }

    // 2. Try direct Jupiter API endpoints
    const directEndpoints = [
      `https://api.jup.ag/swap/v1/quote?inputMint=${params.inputMint}&outputMint=${params.outputMint}&amount=${inputAmount}&slippageBps=${slippageBps}`,
      `https://lite-api.jup.ag/v6/quote?inputMint=${params.inputMint}&outputMint=${params.outputMint}&amount=${inputAmount}&slippageBps=${slippageBps}`,
      `https://quote-api.jup.ag/v6/quote?inputMint=${params.inputMint}&outputMint=${params.outputMint}&amount=${inputAmount}&slippageBps=${slippageBps}`,
    ];

    for (const url of directEndpoints) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.outAmount && Number(data.outAmount) > 0 && Array.isArray(data.routePlan) && data.routePlan.length > 0) {
            return data as QuoteResponse;
          }
        }
      } catch (e: any) {
        // Continue trying next endpoint
      }
    }

    // Strictly enforce Jupiter-only route requirement without synthetic fallbacks
    throw new Error(`NO_JUPITER_ROUTE: Unable to fetch executable Jupiter route for ${params.inputMint} -> ${params.outputMint}. Real Jupiter liquidity required.`);
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' | 'MAX_HOLD' | 'MANUAL' | 'FORCE_EXIT' | string = 'entry',
    preValidatedQuote?: QuoteResponse | null
  ): Promise<SwapResult> {
    const startTime = Date.now();
    try {
      this.checkNetworkSafety();

      if (slippageBps > 1000) {
        throw new ExecutionError(
          'slippage_failure',
          `EXCESSIVE_SLIPPAGE: Slippage BPS ${slippageBps} exceeds maximum allowable limit of 1000 (10%).`
        );
      }

      const paperStore = usePaperWalletStore.getState();
      const isBuy = isSolMint(inputMint);
      const isSell = isSolMint(outputMint);
      const isRecovery = label === 'exit_sl';

      if (isBuy) {
        // 1. SOL -> Token (BUY): amount is strictly in raw lamports
        const inputLamports = Math.floor(amount);
        if (inputLamports <= 0 || !Number.isFinite(inputLamports)) {
          throw new ExecutionError(
            'quote_failure',
            `INVALID_SWAP_AMOUNT: Buy amount must be a positive integer in lamports (got: ${amount})`
          );
        }

        const solRequired = inputLamports / 1e9;
        const simGasAndJitoFee = getDynamicOperationalFeeSol(isRecovery, solRequired);

        // Check if ATA account needs to be created on first purchase
        const hasAta = await this.hasTokenAccount(outputMint);
        const isFirstBuy = !hasAta;
        const ataRent = isFirstBuy ? ATA_RENT_EXEMPTION_SOL : 0;
        const totalSolNeeded = solRequired + simGasAndJitoFee + ataRent;

        if (paperStore.solBalance < totalSolNeeded) {
          const errMsg = `INSUFFICIENT_FUNDS: Required ${totalSolNeeded.toFixed(6)} SOL (incl. ${simGasAndJitoFee.toFixed(6)} fee + ${ataRent.toFixed(6)} ATA rent), Available ${paperStore.solBalance.toFixed(6)} SOL.`;
          throw new ExecutionError('transaction_failure', `PAPER_EXECUTION_FAILED: ${errMsg}`);
        }

        // Pre-fetch quote and validate safety
        const initialQuote = preValidatedQuote || await this.getQuote({ inputMint, outputMint, amount: inputLamports, slippageBps });
        this.validateQuoteSafety(initialQuote, inputLamports, slippageBps);

        // Simulated execution delay
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Execution-time fresh quote
        const freshQuote = await this.getQuote({ inputMint, outputMint, amount: inputLamports, slippageBps });
        this.validateQuoteSafety(freshQuote, inputLamports, slippageBps);

        JupiterTransactionReplay.validateExecutionReQuote({
          initialQuote,
          freshQuote,
          slippageBps,
        });

        const rawTokenOut = Number(freshQuote.outAmount) || 0;

        const outDecimals = await resolveTokenDecimalsAsync(outputMint);
        const tokenOutAmount = rawTokenOut / Math.pow(10, outDecimals);

        // Execute Paper Buy: deduct SOL and record position with full cost basis
        paperStore.adjustSolBalance(-totalSolNeeded);
        paperStore.recordBuyPosition(outputMint, tokenOutAmount, totalSolNeeded);

        const totalFeesForTrade = simGasAndJitoFee + ataRent;
        this.telemetryTotalSwaps++;
        this.telemetryTotalFeesPaidSol += totalFeesForTrade;
        const landingTimeMs = Date.now() - startTime;
        this.telemetryLandingTimeTotalMs += landingTimeMs;

        const txHash = `paper_buy_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        return {
          signature: txHash,
          inputMint,
          outputMint,
          inputAmount: inputLamports,
          outputAmount: rawTokenOut,
          feeSol: totalFeesForTrade,
          totalCostSol: totalSolNeeded,
          slot: Math.floor(Date.now() / 400),
          landingTimeMs,
          method: 'rpc',
          simulated: true,
        };
      } else if (isSell) {
        // 2. Token -> SOL (SELL): amount is strictly in raw base units
        const inDecimals = await resolveTokenDecimalsAsync(inputMint);
        const rawInputTokens = Math.floor(amount);
        if (rawInputTokens <= 0 || !Number.isFinite(rawInputTokens)) {
          throw new ExecutionError(
            'quote_failure',
            `INVALID_SWAP_AMOUNT: Sell amount must be a positive integer in base units (got: ${amount})`
          );
        }

        let tokenAmount = rawInputTokens / Math.pow(10, inDecimals);
        const currentTokenBal = paperStore.tokenBalances[inputMint] || 0;

        // Strict balance check: Never allow selling more tokens than owned
        if (currentTokenBal < tokenAmount - 1e-6) {
          const errMsg = `INSUFFICIENT_FUNDS: Required ${tokenAmount.toFixed(6)} tokens, Available ${currentTokenBal.toFixed(6)}.`;
          throw new ExecutionError('transaction_failure', `PAPER_EXECUTION_FAILED: ${errMsg}`);
        }
        if (tokenAmount > currentTokenBal) {
          tokenAmount = currentTokenBal;
        }

        // Pre-fetch quote and validate safety
        const initialQuote = preValidatedQuote || await this.getQuote({ inputMint, outputMint, amount: rawInputTokens, slippageBps });
        this.validateQuoteSafety(initialQuote, rawInputTokens, slippageBps);

        // Simulated execution delay
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Execution-time fresh quote check
        let freshQuote: QuoteResponse;
        try {
          freshQuote = await this.getQuote({ inputMint, outputMint, amount: rawInputTokens, slippageBps });
          this.validateQuoteSafety(freshQuote, rawInputTokens, slippageBps);
        } catch (quoteErr: any) {
          const errMsg = `Jupiter quote unavailable or stale during sell execution: ${quoteErr?.message || String(quoteErr)}`;
          throw new ExecutionError('quote_failure', `PAPER_EXECUTION_FAILED: ${errMsg}`);
        }

        JupiterTransactionReplay.validateExecutionReQuote({
          initialQuote,
          freshQuote,
          slippageBps,
        });

        const rawSolOutLamports = Number(freshQuote.outAmount) || 0;
        const solOut = rawSolOutLamports / 1e9;
        const simGasAndJitoFee = getDynamicOperationalFeeSol(isRecovery, solOut);
        const netSolReceived = Math.max(0, solOut - simGasAndJitoFee);

        // Check against position cost basis before recording paper sell
        const paperPos = paperStore.positions[inputMint];
        const positionCostBasis = paperPos?.totalCostSol || 0;

        if (positionCostBasis > 0) {
          // If Jupiter says executable exit would be profitable while signal was negative (exit_sl), revalidate instead
          if (label === 'exit_sl' && netSolReceived >= positionCostBasis) {
            console.warn(`[PaperTradeExecutor] ⚠️ Jupiter executable quote is profitable (${netSolReceived.toFixed(4)} SOL >= ${positionCostBasis.toFixed(4)} SOL cost) for negative signal exit. Aborting sell for revalidation.`);
            throw new ExecutionError(
              'slippage_failure',
              `PAPER_EXECUTION_REVALIDATE: Executable quote is profitable (${netSolReceived.toFixed(4)} SOL >= ${positionCostBasis.toFixed(4)} SOL cost). Aborting negative exit for revalidation.`
            );
          }

          // If Jupiter quote claims >80% loss while position was not down >80% in market, treat as anomalous and refuse to manufacture loss
          const quotePnlPct = ((netSolReceived - positionCostBasis) / positionCostBasis) * 100;
          if (quotePnlPct < -80) {
            console.warn(`[PaperTradeExecutor] ⚠️ Anomalous Jupiter quote detected (${quotePnlPct.toFixed(2)}% loss). Refusing to manufacture loss.`);
            throw new ExecutionError(
              'quote_failure',
              `PAPER_EXECUTION_FAILED: Anomalous Jupiter quote (${quotePnlPct.toFixed(2)}% loss). Refusing to manufacture loss.`
            );
          }
        }

        // Execute Paper Sell: deduct token and add net SOL received
        paperStore.recordSellPosition(inputMint, tokenAmount, netSolReceived);
        paperStore.adjustSolBalance(netSolReceived);

        this.telemetryTotalSwaps++;
        this.telemetryTotalFeesPaidSol += simGasAndJitoFee;
        const landingTimeMs = Date.now() - startTime;
        this.telemetryLandingTimeTotalMs += landingTimeMs;

        const txHash = `paper_sell_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        return {
          signature: txHash,
          inputMint,
          outputMint,
          inputAmount: rawInputTokens,
          outputAmount: rawSolOutLamports,
          feeSol: simGasAndJitoFee,
          totalCostSol: netSolReceived,
          slot: Math.floor(Date.now() / 400),
          landingTimeMs,
          method: 'rpc',
          simulated: true,
        };
      } else {
        // 3. Token -> Token swap: Strictly preserve SOL balance integrity
        const inDecimals = await resolveTokenDecimalsAsync(inputMint);
        const outDecimals = await resolveTokenDecimalsAsync(outputMint);
        const rawInputTokens = Math.floor(amount);

        if (rawInputTokens <= 0 || !Number.isFinite(rawInputTokens)) {
          throw new ExecutionError(
            'quote_failure',
            `INVALID_SWAP_AMOUNT: Swap amount must be a positive integer in base units (got: ${amount})`
          );
        }

        const inputTokenAmount = rawInputTokens / Math.pow(10, inDecimals);
        const currentTokenBal = paperStore.tokenBalances[inputMint] || 0;

        if (currentTokenBal < inputTokenAmount) {
          const errMsg = `INSUFFICIENT_FUNDS: Required ${inputTokenAmount.toFixed(6)} ${inputMint}, Available ${currentTokenBal.toFixed(6)}.`;
          throw new ExecutionError('transaction_failure', `PAPER_EXECUTION_FAILED: ${errMsg}`);
        }

        const simGasAndJitoFee = getDynamicOperationalFeeSol(false, 0.05);

        if (paperStore.solBalance < simGasAndJitoFee) {
          const errMsg = `INSUFFICIENT_FUNDS_FOR_FEE: Required ${simGasAndJitoFee.toFixed(6)} SOL for network fee, Available ${paperStore.solBalance.toFixed(6)} SOL.`;
          throw new ExecutionError('transaction_failure', `PAPER_EXECUTION_FAILED: ${errMsg}`);
        }

        const initialQuote = await this.getQuote({ inputMint, outputMint, amount: rawInputTokens, slippageBps });
        this.validateQuoteSafety(initialQuote, rawInputTokens, slippageBps);

        await new Promise((resolve) => setTimeout(resolve, 150));

        const freshQuote = await this.getQuote({ inputMint, outputMint, amount: rawInputTokens, slippageBps });
        this.validateQuoteSafety(freshQuote, rawInputTokens, slippageBps);

        JupiterTransactionReplay.validateExecutionReQuote({
          initialQuote,
          freshQuote,
          slippageBps,
        });

        const rawTokenOut = Number(freshQuote.outAmount) || 0;
        const outputTokenAmount = rawTokenOut / Math.pow(10, outDecimals);

        // Deduct input token, add output token, deduct network fee from SOL
        paperStore.recordSellPosition(inputMint, inputTokenAmount);
        paperStore.adjustTokenBalance(outputMint, outputTokenAmount);
        paperStore.adjustSolBalance(-simGasAndJitoFee);

        this.telemetryTotalSwaps++;
        this.telemetryTotalFeesPaidSol += simGasAndJitoFee;
        const landingTimeMs = Date.now() - startTime;
        this.telemetryLandingTimeTotalMs += landingTimeMs;

        const txHash = `paper_swap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        return {
          signature: txHash,
          inputMint,
          outputMint,
          inputAmount: rawInputTokens,
          outputAmount: rawTokenOut,
          feeSol: simGasAndJitoFee,
          slot: Math.floor(Date.now() / 400),
          landingTimeMs,
          method: 'rpc',
          simulated: true,
        };
      }
    } catch (err: any) {
      const classification = classifyExecutionError(err);
      this.telemetryFailedSwaps++;
      this.lastFailureReason = `[${classification}] ${err.message || String(err)}`;
      throw new ExecutionError(classification, err.message || String(err));
    }
  }

  async batchSwap(
    swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number; label?: 'entry' | 'exit_tp' | 'exit_sl' }>
  ): Promise<SwapResult[]> {
    const results: SwapResult[] = [];
    for (const s of swaps) {
      const res = await this.swap(s.inputMint, s.outputMint, s.amount, s.slippageBps, s.label || 'entry');
      results.push(res);
    }
    return results;
  }

  async getSolBalance(): Promise<number> {
    return usePaperWalletStore.getState().solBalance;
  }

  async getTokenBalance(mint: string): Promise<number> {
    const uiBalance = usePaperWalletStore.getState().tokenBalances[mint] || 0;
    const decimals = await resolveTokenDecimalsAsync(mint);
    return Math.floor(uiBalance * Math.pow(10, decimals));
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    return usePaperWalletStore.getState().hasTokenAccount(mint);
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
