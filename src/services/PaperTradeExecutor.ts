// src/services/PaperTradeExecutor.ts
import { QuoteGetRequest, QuoteResponse, createJupiterApiClient } from '@jup-ag/api';
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { SOL_MINT } from '../constants/solana';

const BASE_TX_FEE_SOL = 0.000005;
const ATA_RENT_SOL = 0.00203928;
const DEFAULT_COMPUTE_UNITS = 140_000;

export interface PaperTradeConfig {
  jupiterEndpoint: string;
  jupiterApiKey: string;
  initialSolBalance: number;
  failureRate?: number;
  latencyRange?: [number, number];
  priorityFeeMicroLamports?: number;
}

export interface VirtualTokenAccount {
  mint: string;
  amount: number;
  decimals: number;
  costBasisSol: number;
  entryTime: number;
}

export interface PaperTx {
  signature: string;
  timestamp: number;
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  feeSol: number;
  netSolEffect: number;
  realizedPnlSol?: number;
  success: boolean;
  reason?: string;
}

export interface SimulationLedgerSummary {
  cashSol: number;
  initialSol: number;
  realizedPnlSol: number;
  openCostBasisSol: number;
  unrealizedPnlSol: number;
  totalEquitySol: number;
  openTokensCount: number;
}

export class PaperTradeExecutor implements ITradeExecutor {
  readonly mode = 'paper' as const;
  readonly publicKey: string;

  private jupiterApi: ReturnType<typeof createJupiterApiClient>;
  private config: Required<PaperTradeConfig>;
  private virtualSol: number;
  private initialSolBalance: number;
  private virtualTokens = new Map<string, VirtualTokenAccount>();
  private txHistory: PaperTx[] = [];
  private txCounter = 0;
  private createdATAs = new Set<string>();
  private realizedPnl = 0;

  constructor(config: PaperTradeConfig) {
    this.config = {
      failureRate: 0.0, // Clean simulation by default
      latencyRange: [50, 150],
      priorityFeeMicroLamports: 10_000,
      ...config,
    };
    this.jupiterApi = createJupiterApiClient({ basePath: config.jupiterEndpoint });
    this.publicKey = 'Paper' + Math.random().toString(36).slice(2, 10).toUpperCase();
    this.virtualSol = this.config.initialSolBalance;
    this.initialSolBalance = this.config.initialSolBalance;
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    return this.jupiterApi.quoteGet(params);
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' | 'exit_manual' = 'entry'
  ): Promise<SwapResult> {
    const start = Date.now();

    const isBuy = inputMint === SOL_MINT;
    const isSell = outputMint === SOL_MINT;

    // Check token balance if selling before querying quote
    if (isSell) {
      const currentBalance = this.getVirtualTokenBalance(inputMint);
      if (currentBalance < amount && currentBalance <= 0) {
        throw new Error(`Paper trade: no token balance found for ${inputMint}`);
      }
    }

    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      restrictIntermediateTokens: true,
    });

    const latency = this.randomLatency();
    await this.sleep(latency);

    if (this.config.failureRate > 0 && Math.random() < this.config.failureRate) {
      const err = this.randomFailureReason();
      this.txHistory.push({
        signature: `FAILED-${++this.txCounter}`,
        timestamp: Date.now(),
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: 0,
        feeSol: BASE_TX_FEE_SOL,
        netSolEffect: -BASE_TX_FEE_SOL,
        success: false,
        reason: err,
      });
      throw new Error(`Paper trade simulated failure: ${err}`);
    }

    const priorityFeeSol = (this.config.priorityFeeMicroLamports * DEFAULT_COMPUTE_UNITS) / 1e15;
    const isNewATA = !this.createdATAs.has(outputMint) && outputMint !== SOL_MINT;
    const ataRent = isNewATA ? ATA_RENT_SOL : 0;
    const totalFeeSol = BASE_TX_FEE_SOL + priorityFeeSol + ataRent;

    const outputAmount = Number(quote.outAmount);
    const inputAmountLamports = Number(quote.inAmount);

    let netSolEffect = 0;
    let tradeRealizedPnl: number | undefined;

    if (isBuy) {
      const solSpentWithFees = (inputAmountLamports / 1e9) + totalFeeSol;
      if (this.virtualSol < solSpentWithFees) {
        throw new Error(`Paper trade: insufficient SOL balance (Required: ${solSpentWithFees.toFixed(4)}, Available: ${this.virtualSol.toFixed(4)})`);
      }
      this.virtualSol -= solSpentWithFees;
      this.addTokenBalance(outputMint, outputAmount, 6, solSpentWithFees);
      if (isNewATA) this.createdATAs.add(outputMint);
      netSolEffect = -solSpentWithFees;
    } else if (isSell) {
      const { costBasisDeducted } = this.subTokenBalance(inputMint, inputAmountLamports);
      const grossReceivedSol = outputAmount / 1e9;
      const netSolReceived = Math.max(0, grossReceivedSol - totalFeeSol);
      this.virtualSol += netSolReceived;
      tradeRealizedPnl = netSolReceived - costBasisDeducted;
      this.realizedPnl += tradeRealizedPnl;
      netSolEffect = netSolReceived;
    } else {
      this.subTokenBalance(inputMint, inputAmountLamports);
      this.addTokenBalance(outputMint, outputAmount, 6, 0);
    }

    const signature = `PAPER-${++this.txCounter}-${Date.now()}`;
    const result: SwapResult = {
      signature,
      inputMint,
      outputMint,
      inputAmount: inputAmountLamports,
      outputAmount,
      feeSol: totalFeeSol,
      slot: Math.floor(Date.now() / 400),
      landingTimeMs: Date.now() - start,
      method: 'rpc',
      simulated: true,
    };

    this.txHistory.push({
      signature,
      timestamp: Date.now(),
      inputMint,
      outputMint,
      inputAmount: inputAmountLamports,
      outputAmount,
      feeSol: totalFeeSol,
      netSolEffect,
      realizedPnlSol: tradeRealizedPnl,
      success: true,
    });

    return result;
  }

  async batchSwap(
    swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number }>
  ): Promise<SwapResult[]> {
    const start = Date.now();
    const results: SwapResult[] = [];
    const batchPriorityFeeSol = (this.config.priorityFeeMicroLamports * 1_400_000) / 1e15;
    const perSwapFee = (BASE_TX_FEE_SOL + batchPriorityFeeSol) / (swaps.length || 1);

    // Pre-validate total SOL required for all buys
    let totalSolRequiredForBuys = 0;
    for (const s of swaps) {
      if (s.inputMint === SOL_MINT) {
        totalSolRequiredForBuys += (s.amount / 1e9) + perSwapFee;
      }
    }

    if (totalSolRequiredForBuys > this.virtualSol) {
      throw new Error(`Paper trade batch: insufficient SOL balance (Required: ${totalSolRequiredForBuys.toFixed(4)}, Available: ${this.virtualSol.toFixed(4)})`);
    }

    for (const s of swaps) {
      try {
        const quote = await this.getQuote({
          inputMint: s.inputMint,
          outputMint: s.outputMint,
          amount: s.amount,
          slippageBps: s.slippageBps,
          restrictIntermediateTokens: true,
        });

        const outputAmount = Number(quote.outAmount);
        const inputAmount = Number(quote.inAmount);
        const isNewATA = !this.createdATAs.has(s.outputMint) && s.outputMint !== SOL_MINT;
        const ataRent = isNewATA ? ATA_RENT_SOL : 0;
        const totalFee = perSwapFee + ataRent;

        let netSolEffect = 0;
        let tradeRealizedPnl: number | undefined;

        if (s.inputMint === SOL_MINT) {
          const cost = (inputAmount / 1e9) + totalFee;
          if (this.virtualSol < cost) {
            throw new Error('Insufficient SOL for swap in batch');
          }
          this.virtualSol -= cost;
          this.addTokenBalance(s.outputMint, outputAmount, 6, cost);
          if (isNewATA) this.createdATAs.add(s.outputMint);
          netSolEffect = -cost;
        } else if (s.outputMint === SOL_MINT) {
          const { costBasisDeducted } = this.subTokenBalance(s.inputMint, inputAmount);
          const netReceived = Math.max(0, (outputAmount / 1e9) - totalFee);
          this.virtualSol += netReceived;
          tradeRealizedPnl = netReceived - costBasisDeducted;
          this.realizedPnl += tradeRealizedPnl;
          netSolEffect = netReceived;
        }

        const signature = `PAPER-BATCH-${++this.txCounter}`;
        results.push({
          signature,
          inputMint: s.inputMint,
          outputMint: s.outputMint,
          inputAmount,
          outputAmount,
          feeSol: totalFee,
          slot: Math.floor(Date.now() / 400),
          landingTimeMs: Date.now() - start,
          method: 'rpc',
          simulated: true,
        });

        this.txHistory.push({
          signature,
          timestamp: Date.now(),
          inputMint: s.inputMint,
          outputMint: s.outputMint,
          inputAmount,
          outputAmount,
          feeSol: totalFee,
          netSolEffect,
          realizedPnlSol: tradeRealizedPnl,
          success: true,
        });
      } catch (err: any) {
        results.push({
          signature: `FAILED-BATCH-${++this.txCounter}`,
          inputMint: s.inputMint,
          outputMint: s.outputMint,
          inputAmount: s.amount,
          outputAmount: 0,
          feeSol: perSwapFee,
          slot: 0,
          landingTimeMs: Date.now() - start,
          method: 'rpc',
          simulated: true,
        });
      }
    }

    return results;
  }

  async getSolBalance(): Promise<number> {
    return this.virtualSol;
  }

  public setVirtualSol(sol: number): void {
    this.virtualSol = Math.max(0, sol);
  }

  public resetLedger(initialSol: number = 10.0): void {
    this.initialSolBalance = initialSol;
    this.virtualSol = initialSol;
    this.virtualTokens.clear();
    this.createdATAs.clear();
    this.txHistory = [];
    this.realizedPnl = 0;
  }

  async getTokenBalance(mint: string): Promise<number> {
    return this.getVirtualTokenBalance(mint);
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    return (this.virtualTokens.get(mint)?.amount || 0) > 0;
  }

  public getRealizedPnl(): number {
    return this.realizedPnl;
  }

  public getOpenCostBasis(): number {
    let total = 0;
    for (const item of this.virtualTokens.values()) {
      total += item.costBasisSol;
    }
    return total;
  }

  public getLedgerSummary(currentPrices?: Record<string, number>): SimulationLedgerSummary {
    const cashSol = this.virtualSol;
    const initialSol = this.initialSolBalance;
    const realizedPnlSol = this.realizedPnl;
    const openCostBasisSol = this.getOpenCostBasis();
    
    let openPositionsValue = 0;
    if (currentPrices) {
      for (const [mint, tok] of this.virtualTokens.entries()) {
        const p = currentPrices[mint] || 0;
        const dec = tok.decimals || 6;
        const readableAmount = tok.amount / Math.pow(10, dec);
        openPositionsValue += (readableAmount * p);
      }
    } else {
      openPositionsValue = openCostBasisSol;
    }

    const unrealizedPnlSol = openPositionsValue - openCostBasisSol;
    const totalEquitySol = cashSol + openPositionsValue;

    return {
      cashSol,
      initialSol,
      realizedPnlSol,
      openCostBasisSol,
      unrealizedPnlSol,
      totalEquitySol,
      openTokensCount: this.virtualTokens.size,
    };
  }

  getTelemetry(): ExecutorTelemetry {
    const successes = this.txHistory.filter(t => t.success);
    return {
      totalSwaps: this.txHistory.length,
      totalFeesPaidSol: this.txHistory.reduce((s, t) => s + t.feeSol, 0),
      avgLandingTimeMs: successes.length
        ? successes.reduce((sum, t) => sum + 100, 0) / successes.length
        : 0,
      failureRate: this.txHistory.length
        ? this.txHistory.filter(t => !t.success).length / this.txHistory.length
        : 0,
      lastFailure: this.txHistory.filter(t => !t.success).at(-1)?.signature,
    };
  }

  serialize(): string {
    return JSON.stringify({
      virtualSol: this.virtualSol,
      initialSolBalance: this.initialSolBalance,
      realizedPnl: this.realizedPnl,
      virtualTokens: Array.from(this.virtualTokens.entries()),
      createdATAs: Array.from(this.createdATAs),
      txHistory: this.txHistory,
      txCounter: this.txCounter,
    });
  }

  static deserialize(config: PaperTradeConfig, data: string): PaperTradeExecutor {
    const parsed = JSON.parse(data);
    const ex = new PaperTradeExecutor(config);
    ex.virtualSol = parsed.virtualSol ?? config.initialSolBalance;
    ex.initialSolBalance = parsed.initialSolBalance ?? config.initialSolBalance;
    ex.realizedPnl = parsed.realizedPnl ?? 0;
    ex.virtualTokens = new Map(parsed.virtualTokens ?? []);
    ex.createdATAs = new Set(parsed.createdATAs ?? []);
    ex.txHistory = parsed.txHistory ?? [];
    ex.txCounter = parsed.txCounter ?? 0;
    return ex;
  }

  public executeManualSwap(
    inputMint: string,
    outputMint: string,
    inputAmount: number,
    outputAmountRaw: number,
    label: string = 'entry'
  ): string {
    const totalFeeSol = BASE_TX_FEE_SOL;
    let netSolEffect = 0;
    let tradeRealizedPnl: number | undefined;

    if (inputMint === SOL_MINT) {
      // Buying tokens with SOL
      const solSpent = (inputAmount > 1000 ? inputAmount / 1e9 : inputAmount) + totalFeeSol;
      if (this.virtualSol < solSpent) {
        throw new Error(`Paper trade: insufficient SOL balance (Required: ${solSpent.toFixed(4)}, Available: ${this.virtualSol.toFixed(4)})`);
      }
      this.virtualSol -= solSpent;
      this.addTokenBalance(outputMint, outputAmountRaw, 6, solSpent);
      netSolEffect = -solSpent;
    } else if (outputMint === SOL_MINT) {
      // Selling tokens for SOL
      const { costBasisDeducted } = this.subTokenBalance(inputMint, inputAmount);
      const grossReceivedSol = outputAmountRaw / 1e9;
      const netSolReceived = Math.max(0, grossReceivedSol - totalFeeSol);
      this.virtualSol += netSolReceived;
      tradeRealizedPnl = netSolReceived - costBasisDeducted;
      this.realizedPnl += tradeRealizedPnl;
      netSolEffect = netSolReceived;
    }
    
    const signature = `PAPER-MANUAL-${++this.txCounter}-${Date.now()}`;
    this.txHistory.push({
      signature,
      timestamp: Date.now(),
      inputMint,
      outputMint,
      inputAmount,
      outputAmount: outputAmountRaw,
      feeSol: totalFeeSol,
      netSolEffect,
      realizedPnlSol: tradeRealizedPnl,
      success: true,
    });
    return signature;
  }

  private getVirtualTokenBalance(mint: string): number {
    return this.virtualTokens.get(mint)?.amount || 0;
  }

  private addTokenBalance(mint: string, amount: number, decimals: number, costBasisSol: number) {
    const existing = this.virtualTokens.get(mint);
    if (existing) {
      existing.amount += amount;
      existing.costBasisSol += costBasisSol;
    } else {
      this.virtualTokens.set(mint, {
        mint,
        amount,
        decimals,
        costBasisSol,
        entryTime: Date.now()
      });
    }
  }

  private subTokenBalance(mint: string, amount: number): { costBasisDeducted: number } {
    const existing = this.virtualTokens.get(mint);
    if (!existing || existing.amount <= 0) {
      return { costBasisDeducted: 0 };
    }

    const deductAmount = Math.min(existing.amount, amount);
    const fraction = existing.amount > 0 ? (deductAmount / existing.amount) : 1;
    const costBasisDeducted = existing.costBasisSol * fraction;

    existing.amount -= deductAmount;
    existing.costBasisSol = Math.max(0, existing.costBasisSol - costBasisDeducted);

    if (existing.amount <= 0) {
      this.virtualTokens.delete(mint);
    }

    return { costBasisDeducted };
  }

  private randomLatency(): number {
    const [min, max] = this.config.latencyRange;
    return Math.floor(min + Math.random() * (max - min));
  }

  private randomFailureReason(): string {
    const reasons = [
      'blockhash not found',
      'insufficient funds for rent',
      'compute budget exceeded',
      'slippage tolerance exceeded',
      '0x1: custom program error',
      'RPC timeout',
    ];
    return reasons[Math.floor(Math.random() * reasons.length)];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
