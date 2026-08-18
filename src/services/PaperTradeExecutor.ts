// src/services/PaperTradeExecutor.ts
import { QuoteGetRequest, QuoteResponse, createJupiterApiClient } from '@jup-ag/api';
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';

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

interface VirtualTokenAccount {
  mint: string;
  amount: number;
  decimals: number;
}

interface PaperTx {
  signature: string;
  timestamp: number;
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  feeSol: number;
  success: boolean;
}

export class PaperTradeExecutor implements ITradeExecutor {
  readonly mode = 'paper' as const;
  readonly publicKey: string;

  private jupiterApi: ReturnType<typeof createJupiterApiClient>;
  private config: Required<PaperTradeConfig>;
  private virtualSol: number;
  private virtualTokens = new Map<string, VirtualTokenAccount>();
  private txHistory: PaperTx[] = [];
  private txCounter = 0;
  private createdATAs = new Set<string>();

  constructor(config: PaperTradeConfig) {
    this.config = {
      failureRate: 0.03,
      latencyRange: [250, 900],
      priorityFeeMicroLamports: 10_000,
      ...config,
    };
    this.jupiterApi = createJupiterApiClient({ basePath: config.jupiterEndpoint });
    this.publicKey = 'Paper' + Math.random().toString(36).slice(2, 10).toUpperCase();
    this.virtualSol = this.config.initialSolBalance;
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    return this.jupiterApi.quoteGet(params);
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry'
  ): Promise<SwapResult> {
    const start = Date.now();

    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      restrictIntermediateTokens: true,
    });

    const latency = this.randomLatency();
    await this.sleep(latency);

    if (Math.random() < this.config.failureRate) {
      const err = this.randomFailureReason();
      this.txHistory.push({
        signature: `FAILED-${++this.txCounter}`,
        timestamp: Date.now(),
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: 0,
        feeSol: BASE_TX_FEE_SOL,
        success: false,
      });
      throw new Error(`Paper trade simulated failure: ${err}`);
    }

    const priorityFeeSol = (this.config.priorityFeeMicroLamports * DEFAULT_COMPUTE_UNITS) / 1e15;
    const isNewATA = !this.createdATAs.has(outputMint)
      && outputMint !== 'So11111111111111111111111111111111111111112';
    const ataRent = isNewATA ? ATA_RENT_SOL : 0;
    const totalFeeSol = BASE_TX_FEE_SOL + priorityFeeSol + ataRent;

    const outputAmount = Number(quote.outAmount);
    const inputAmountLamports = Number(quote.inAmount);

    if (inputMint === 'So11111111111111111111111111111111111111112') {
      if (this.virtualSol < (inputAmountLamports / 1e9) + totalFeeSol) {
        throw new Error('Paper trade: insufficient SOL balance');
      }
      this.virtualSol -= (inputAmountLamports / 1e9) + totalFeeSol;
      this.addTokenBalance(outputMint, outputAmount, 0);
      if (isNewATA) this.createdATAs.add(outputMint);
    } else if (outputMint === 'So11111111111111111111111111111111111111112') {
      const tokenBalance = this.getVirtualTokenBalance(inputMint);
      if (tokenBalance < inputAmountLamports) {
        throw new Error(`Paper trade: insufficient token balance for ${inputMint}`);
      }
      this.subTokenBalance(inputMint, inputAmountLamports);
      this.virtualSol += (outputAmount / 1e9) - totalFeeSol;
    } else {
      this.subTokenBalance(inputMint, inputAmountLamports);
      this.addTokenBalance(outputMint, outputAmount, 0);
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
    const perSwapFee = (BASE_TX_FEE_SOL + batchPriorityFeeSol) / swaps.length;

    for (const s of swaps) {
      const quote = await this.getQuote({
        inputMint: s.inputMint,
        outputMint: s.outputMint,
        amount: s.amount,
        slippageBps: s.slippageBps,
        restrictIntermediateTokens: true,
      });

      const latency = this.randomLatency();
      await this.sleep(latency);

      if (Math.random() < this.config.failureRate) {
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
        continue;
      }

      const outputAmount = Number(quote.outAmount);
      const isNewATA = !this.createdATAs.has(s.outputMint)
        && s.outputMint !== 'So11111111111111111111111111111111111111112';
      const ataRent = isNewATA ? ATA_RENT_SOL : 0;

      if (s.inputMint === 'So11111111111111111111111111111111111111112') {
        this.virtualSol -= (Number(quote.inAmount) / 1e9) + perSwapFee + ataRent;
        this.addTokenBalance(s.outputMint, outputAmount, 0);
        if (isNewATA) this.createdATAs.add(s.outputMint);
      } else if (s.outputMint === 'So11111111111111111111111111111111111111112') {
        this.subTokenBalance(s.inputMint, Number(quote.inAmount));
        this.virtualSol += (outputAmount / 1e9) - perSwapFee;
      }

      results.push({
        signature: `PAPER-BATCH-${++this.txCounter}`,
        inputMint: s.inputMint,
        outputMint: s.outputMint,
        inputAmount: Number(quote.inAmount),
        outputAmount,
        feeSol: perSwapFee + ataRent,
        slot: Math.floor(Date.now() / 400),
        landingTimeMs: Date.now() - start,
        method: 'rpc',
        simulated: true,
      });
    }

    return results;
  }

  async getSolBalance(): Promise<number> {
    return this.virtualSol;
  }

  async getTokenBalance(mint: string): Promise<number> {
    return this.getVirtualTokenBalance(mint);
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    return this.virtualTokens.has(mint);
  }

  getTelemetry(): ExecutorTelemetry {
    const successes = this.txHistory.filter(t => t.success);
    return {
      totalSwaps: this.txHistory.length,
      totalFeesPaidSol: this.txHistory.reduce((s, t) => s + t.feeSol, 0),
      avgLandingTimeMs: successes.length
        ? successes.reduce((sum, t) => sum + 300, 0) / successes.length
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
      virtualTokens: Array.from(this.virtualTokens.entries()),
      createdATAs: Array.from(this.createdATAs),
      txHistory: this.txHistory,
      txCounter: this.txCounter,
    });
  }

  static deserialize(config: PaperTradeConfig, data: string): PaperTradeExecutor {
    const parsed = JSON.parse(data);
    const ex = new PaperTradeExecutor(config);
    ex.virtualSol = parsed.virtualSol;
    ex.virtualTokens = new Map(parsed.virtualTokens);
    ex.createdATAs = new Set(parsed.createdATAs);
    ex.txHistory = parsed.txHistory;
    ex.txCounter = parsed.txCounter;
    return ex;
  }


  public executeManualSwap(
    inputMint: string,
    outputMint: string,
    inputAmountSol: number,
    outputAmountRaw: number,
    label: string = 'entry'
  ): string {
    const BASE_TX_FEE_SOL = 0.000005; // Make sure this exists
    const totalFeeSol = BASE_TX_FEE_SOL;
    
    if (inputMint === 'So11111111111111111111111111111111111111112') {
      if (this.virtualSol < inputAmountSol + totalFeeSol) {
        throw new Error('Paper trade: insufficient SOL balance');
      }
      this.virtualSol -= (inputAmountSol + totalFeeSol);
      this.addTokenBalance(outputMint, outputAmountRaw, 0);
    } else if (outputMint === 'So11111111111111111111111111111111111111112') {
      // Input is tokens, output is SOL
      this.subTokenBalance(inputMint, inputAmountSol); // Note: inputAmountSol is actually tokenAmount raw here
      this.virtualSol += (outputAmountRaw / 1e9) - totalFeeSol;
    }
    
    const signature = `PAPER-MANUAL-${++this.txCounter}-${Date.now()}`;
    this.txHistory.push({
      signature,
      timestamp: Date.now(),
      inputMint,
      outputMint,
      inputAmount: inputAmountSol,
      outputAmount: outputAmountRaw,
      feeSol: totalFeeSol,
      success: true,
    });
    return signature;
  }

  private getVirtualTokenBalance(mint: string): number {
    return this.virtualTokens.get(mint)?.amount || 0;
  }

  private addTokenBalance(mint: string, amount: number, decimals: number) {
    const existing = this.virtualTokens.get(mint);
    if (existing) existing.amount += amount;
    else this.virtualTokens.set(mint, { mint, amount, decimals });
  }

  private subTokenBalance(mint: string, amount: number) {
    const existing = this.virtualTokens.get(mint);
    if (!existing || existing.amount < amount) {
      throw new Error(`Paper trade: insufficient ${mint} balance`);
    }
    existing.amount -= amount;
    if (existing.amount === 0) this.virtualTokens.delete(mint);
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
