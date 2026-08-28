// src/services/PaperTradeExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
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

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

function isSolMint(mint: string): boolean {
  return mint === SOL_MINT || mint === WSOL_MINT;
}

function isPumpMint(mint: string): boolean {
  return typeof mint === 'string' && mint.trim().toLowerCase().endsWith('pump');
}

export function resolveTokenDecimals(tokenMint: string): number {
  const cleanMint = (tokenMint || '').trim();
  if (!cleanMint) return 6;
  if (isSolMint(cleanMint)) return 9;
  if (isPumpMint(cleanMint)) {
    tokenRegistry.registerOrUpdate({ mintAddress: cleanMint, decimals: 6 });
    return 6;
  }
  const regToken = tokenRegistry.getToken(cleanMint);
  if (regToken?.decimals !== undefined && typeof regToken.decimals === 'number') return regToken.decimals;
  const metric = useAppStore.getState()?.tokenMetrics?.[cleanMint] as any;
  if (metric?.decimals !== undefined && typeof metric.decimals === 'number') return metric.decimals;
  return 6;
}

export async function resolveTokenDecimalsAsync(tokenMint: string): Promise<number> {
  const cleanMint = (tokenMint || '').trim();
  if (!cleanMint) return 6;
  if (isSolMint(cleanMint)) return 9;
  if (isPumpMint(cleanMint)) {
    tokenRegistry.registerOrUpdate({ mintAddress: cleanMint, decimals: 6 });
    return 6;
  }
  
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

  // 4. Query DexScreener
  try {
    const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${cleanMint}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.pairs && data.pairs.length > 0) {
        const sortedPairs = [...data.pairs].sort((a: any, b: any) => {
          const liqA = Number(a.liquidity?.usd || 0);
          const liqB = Number(b.liquidity?.usd || 0);
          return liqB - liqA;
        });
        const bestPair = sortedPairs[0];
        const isBase = bestPair.baseToken?.address === cleanMint || bestPair.baseToken?.mint === cleanMint;
        const discoveredDecimals = isBase ? bestPair.baseToken?.decimals : bestPair.quoteToken?.decimals;
        if (typeof discoveredDecimals === 'number' && discoveredDecimals >= 0 && discoveredDecimals <= 18) {
          tokenRegistry.registerOrUpdate({
            mintAddress: cleanMint,
            decimals: discoveredDecimals,
            symbol: isBase ? (bestPair.baseToken?.symbol || 'UNKNOWN') : (bestPair.quoteToken?.symbol || 'UNKNOWN'),
          });
          return discoveredDecimals;
        }
      }
    }
  } catch (fetchErr) {
    console.warn(`[PaperTradeExecutor] DexScreener decimal lookup failed for ${cleanMint}:`, fetchErr);
  }
  
  // 5. Standard fallback to 6 (standard SPL token decimals on Solana)
  const defaultDecimals = 6;
  tokenRegistry.registerOrUpdate({ mintAddress: cleanMint, decimals: defaultDecimals });
  return defaultDecimals;
}

export async function resolveTokenPriceInSol(tokenMint: string): Promise<number | null> {
  if (isSolMint(tokenMint)) return 1;

  const solUsd = getSolPriceUsd() || 150;

  // 1. Check AppStore state for tokenMetrics
  try {
    const store = useAppStore.getState();
    const metric = store?.tokenMetrics?.[tokenMint];
    if (metric) {
      if (typeof metric.priceUsd === 'number' && metric.priceUsd > 0) {
        return metric.priceUsd / solUsd;
      }
      if (typeof (metric as any).priceUsd === 'string' && parseFloat((metric as any).priceUsd) > 0) {
        return parseFloat((metric as any).priceUsd) / solUsd;
      }
      // If priceNative exists and is reasonable, check if quote is SOL
      const quoteSymbol = (metric as any).quoteToken || (metric as any).quoteSymbol;
      if (quoteSymbol === 'SOL' || quoteSymbol === 'WSOL' || quoteSymbol === SOL_MINT || quoteSymbol === WSOL_MINT) {
        if (typeof metric.priceNative === 'number' && metric.priceNative > 0) {
          return metric.priceNative;
        }
      }
    }
  } catch (e) {
    // Ignore store access error
  }

  // 2. Fetch directly from DexScreener API with liquidity/volume ranking
  try {
    const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.pairs && data.pairs.length > 0) {
        // Filter for active Solana pairs and sort by highest liquidity, then volume
        const solanaPairs = data.pairs.filter((p: any) => p.chainId === 'solana');
        const candidatePairs = solanaPairs.length > 0 ? solanaPairs : data.pairs;
        
        const sorted = [...candidatePairs].sort((a: any, b: any) => {
          const liqA = Number(a.liquidity?.usd || 0);
          const liqB = Number(b.liquidity?.usd || 0);
          if (liqB !== liqA) return liqB - liqA;
          const volA = Number(a.volume?.h24 || 0);
          const volB = Number(b.volume?.h24 || 0);
          return volB - volA;
        });

        const bestPair = sorted[0];
        const isQuoteSol =
          bestPair.quoteToken?.symbol === 'SOL' ||
          bestPair.quoteToken?.address === SOL_MINT ||
          bestPair.quoteToken?.address === WSOL_MINT;

        if (isQuoteSol && bestPair.priceNative && parseFloat(bestPair.priceNative) > 0) {
          const priceSol = parseFloat(bestPair.priceNative);
          const isBase = bestPair.baseToken?.address === tokenMint || bestPair.baseToken?.mint === tokenMint;
          const decimals = isBase ? bestPair.baseToken?.decimals : bestPair.quoteToken?.decimals;
          if (typeof decimals === 'number') {
            tokenRegistry.registerOrUpdate({
              mintAddress: tokenMint,
              symbol: bestPair.baseToken?.symbol || 'UNKNOWN',
              decimals,
            });
          }
          return priceSol;
        }

        if (bestPair.priceUsd && parseFloat(bestPair.priceUsd) > 0) {
          const priceInSol = parseFloat(bestPair.priceUsd) / solUsd;
          const isBase = bestPair.baseToken?.address === tokenMint || bestPair.baseToken?.mint === tokenMint;
          const decimals = isBase ? bestPair.baseToken?.decimals : bestPair.quoteToken?.decimals;
          if (typeof decimals === 'number') {
            tokenRegistry.registerOrUpdate({
              mintAddress: tokenMint,
              symbol: bestPair.baseToken?.symbol || 'UNKNOWN',
              decimals,
            });
          }
          return priceInSol;
        }
      }
    }
  } catch (e) {
    console.warn(`[PaperTradeExecutor] DexScreener price lookup failed for ${tokenMint}:`, e);
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

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    const inputAmount = Number(params.amount || 0);
    const slippageBps = Math.max(0, Math.min(5000, Number(params.slippageBps || 50)));

    if (inputAmount <= 0 || !Number.isFinite(inputAmount)) {
      throw new Error(`INVALID_QUOTE_REQUEST: Amount must be a positive integer in base units (got: ${params.amount})`);
    }

    // 1. Try Jupiter internal proxy first (handles CORS, fallbacks, and rate-limits)
    try {
      const proxyUrl = `/api/jup/quote?inputMint=${params.inputMint}&outputMint=${params.outputMint}&amount=${inputAmount}&slippageBps=${slippageBps}&t=${Date.now()}`;
      const resp = await fetch(proxyUrl);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.outAmount && Number(data.outAmount) > 0) {
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
          if (data && data.outAmount && Number(data.outAmount) > 0) {
            return data as QuoteResponse;
          }
        }
      } catch (e: any) {
        // Continue trying next endpoint
      }
    }

    // 3. Real Market Price Fallback for bonding curve / Pump.fun / new AMM tokens not yet routed by Jupiter
    const isBuy = isSolMint(params.inputMint);
    const isSell = isSolMint(params.outputMint);

    if (isBuy || isSell) {
      const targetTokenMint = isBuy ? params.outputMint : params.inputMint;
      const realPriceSol = await resolveTokenPriceInSol(targetTokenMint);

      if (realPriceSol && realPriceSol > 0) {
        const targetDecimals = await resolveTokenDecimalsAsync(targetTokenMint);
        let outAmountRaw = 0;

        if (isBuy) {
          const solAmount = inputAmount / 1e9;
          const tokensCount = solAmount / realPriceSol;
          outAmountRaw = Math.floor(tokensCount * Math.pow(10, targetDecimals));
        } else {
          const tokensCount = inputAmount / Math.pow(10, targetDecimals);
          const solAmount = tokensCount * realPriceSol;
          outAmountRaw = Math.floor(solAmount * 1e9);
        }

        if (outAmountRaw > 0) {
          return {
            inputMint: params.inputMint,
            inAmount: params.amount.toString(),
            outputMint: params.outputMint,
            outAmount: outAmountRaw.toString(),
            otherAmountThreshold: Math.floor(outAmountRaw * (1 - slippageBps / 10000)).toString(),
            swapMode: 'ExactIn',
            slippageBps,
            priceImpactPct: '0.05',
            routePlan: [
              {
                swapInfo: {
                  ammKey: 'market_liquidity_pool',
                  label: 'Market Liquidity Pool (DexScreener)',
                  inputMint: params.inputMint,
                  outputMint: params.outputMint,
                  inAmount: params.amount.toString(),
                  outAmount: outAmountRaw.toString(),
                  feeAmount: '0',
                  feeMint: params.inputMint,
                },
                percent: 100,
              },
            ],
          } as unknown as QuoteResponse;
        }
      }
    }

    throw new Error(`PAPER_QUOTE_FAILED: Unable to fetch real market quote or price for ${params.inputMint} -> ${params.outputMint}. Real market liquidity required.`);
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
    const isBuy = isSolMint(inputMint);
    const isSell = isSolMint(outputMint);
    const isRecovery = label === 'exit_sl';

    if (isBuy) {
      // 1. SOL -> Token (BUY): amount is strictly in raw lamports
      const inputLamports = Math.floor(amount);
      if (inputLamports <= 0 || !Number.isFinite(inputLamports)) {
        throw new Error(`INVALID_SWAP_AMOUNT: Buy amount must be a positive integer in lamports (got: ${amount})`);
      }

      const solRequired = inputLamports / 1e9;
      const simGasAndJitoFee = getDynamicOperationalFeeSol(isRecovery, solRequired);

      // Check if ATA account needs to be created on first purchase
      const isFirstBuy = !paperStore.tokenBalances[outputMint] || paperStore.tokenBalances[outputMint] <= 0;
      const ataRent = isFirstBuy ? ATA_RENT_EXEMPTION_SOL : 0;
      const totalSolNeeded = solRequired + simGasAndJitoFee + ataRent;

      if (paperStore.solBalance < totalSolNeeded) {
        this.telemetryFailedSwaps++;
        const errMsg = `INSUFFICIENT_FUNDS: Required ${totalSolNeeded.toFixed(6)} SOL (incl. ${simGasAndJitoFee.toFixed(6)} fee + ${ataRent.toFixed(6)} ATA rent), Available ${paperStore.solBalance.toFixed(6)} SOL.`;
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

      // Pre-fetch quote
      await this.getQuote({ inputMint, outputMint, amount: inputLamports, slippageBps });

      // Simulated execution delay
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Execution-time quote
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
        throw new Error(`INVALID_SWAP_AMOUNT: Sell amount must be a positive integer in base units (got: ${amount})`);
      }

      const tokenAmount = rawInputTokens / Math.pow(10, inDecimals);
      const currentTokenBal = paperStore.tokenBalances[inputMint] || 0;

      // Strict balance check: Never allow selling more tokens than owned
      if (currentTokenBal < tokenAmount) {
        this.telemetryFailedSwaps++;
        const errMsg = `INSUFFICIENT_FUNDS: Required ${tokenAmount.toFixed(6)} tokens, Available ${currentTokenBal.toFixed(6)}.`;
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

      // Pre-fetch quote
      await this.getQuote({ inputMint, outputMint, amount: rawInputTokens, slippageBps });

      // Simulated execution delay
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Execution-time fresh quote check (Requirement 6)
      let freshQuote;
      try {
        freshQuote = await this.getQuote({ inputMint, outputMint, amount: rawInputTokens, slippageBps });
      } catch (quoteErr: any) {
        // Requirement 8: If quote is stale or unavailable, refuse to manufacture a loss
        this.telemetryFailedSwaps++;
        const errMsg = `Jupiter quote unavailable or stale during sell execution: ${quoteErr?.message || String(quoteErr)}`;
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

      const rawSolOutLamports = Number(freshQuote.outAmount) || 0;

      if (rawSolOutLamports <= 0) {
        this.telemetryFailedSwaps++;
        const errMsg = 'Paper swap failed: Invalid or zero SOL output returned by quote.';
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

      const solOut = rawSolOutLamports / 1e9;
      const simGasAndJitoFee = getDynamicOperationalFeeSol(isRecovery, solOut);
      const netSolReceived = Math.max(0, solOut - simGasAndJitoFee);

      // Requirement 7 & 8: Check against position cost basis before recording paper sell
      const paperPos = paperStore.positions[inputMint];
      const positionCostBasis = paperPos?.totalCostSol || 0;

      if (positionCostBasis > 0) {
        // Requirement 7: If Jupiter says executable exit would be profitable while signal was negative (exit_sl), revalidate instead!
        if (label === 'exit_sl' && netSolReceived >= positionCostBasis) {
          console.warn(`[PaperTradeExecutor] ⚠️ Jupiter executable quote is profitable (${netSolReceived.toFixed(4)} SOL >= ${positionCostBasis.toFixed(4)} SOL cost) for negative signal exit. Aborting sell for revalidation.`);
          throw new Error(`PAPER_EXECUTION_REVALIDATE: Executable quote is profitable (${netSolReceived.toFixed(4)} SOL >= ${positionCostBasis.toFixed(4)} SOL cost). Aborting negative exit for revalidation.`);
        }

        // Requirement 8: If Jupiter quote claims >80% loss while position was not down >80% in market, treat as anomalous and refuse to manufacture loss
        const quotePnlPct = ((netSolReceived - positionCostBasis) / positionCostBasis) * 100;
        if (quotePnlPct < -80) {
          console.warn(`[PaperTradeExecutor] ⚠️ Anomalous Jupiter quote detected (${quotePnlPct.toFixed(2)}% loss). Refusing to manufacture loss.`);
          throw new Error(`PAPER_EXECUTION_FAILED: Anomalous Jupiter quote (${quotePnlPct.toFixed(2)}% loss). Refusing to manufacture loss.`);
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
        throw new Error(`INVALID_SWAP_AMOUNT: Swap amount must be a positive integer in base units (got: ${amount})`);
      }

      const inputTokenAmount = rawInputTokens / Math.pow(10, inDecimals);
      const currentTokenBal = paperStore.tokenBalances[inputMint] || 0;

      if (currentTokenBal < inputTokenAmount) {
        this.telemetryFailedSwaps++;
        const errMsg = `INSUFFICIENT_FUNDS: Required ${inputTokenAmount.toFixed(6)} ${inputMint}, Available ${currentTokenBal.toFixed(6)}.`;
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

      const simGasAndJitoFee = getDynamicOperationalFeeSol(false, 0.05);

      if (paperStore.solBalance < simGasAndJitoFee) {
        this.telemetryFailedSwaps++;
        const errMsg = `INSUFFICIENT_FUNDS_FOR_FEE: Required ${simGasAndJitoFee.toFixed(6)} SOL for network fee, Available ${paperStore.solBalance.toFixed(6)} SOL.`;
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

      const freshQuote = await this.getQuote({ inputMint, outputMint, amount: rawInputTokens, slippageBps });
      const rawTokenOut = Number(freshQuote.outAmount) || 0;

      if (rawTokenOut <= 0) {
        this.telemetryFailedSwaps++;
        const errMsg = 'Paper swap failed: Invalid output token amount returned by quote.';
        this.lastFailureReason = errMsg;
        throw new Error(`PAPER_EXECUTION_FAILED: ${errMsg}`);
      }

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
