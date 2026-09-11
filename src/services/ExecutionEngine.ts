// src/services/ExecutionEngine.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { tradingEngine } from './tradingEngine';

export class ExecutionEngine implements ITradeExecutor {
  private static instance: ExecutionEngine;
  public mode: any = 'paper';
  public publicKey: any = null;

  constructor(options?: { network?: string } | any) {
    if (options?.network) {
      this.mode = options.network;
    }
  }

  public static getInstance(mode: string = 'paper'): ExecutionEngine {
    if (!ExecutionEngine.instance) {
      ExecutionEngine.instance = new ExecutionEngine({ network: mode });
    }
    ExecutionEngine.instance.mode = mode;
    return ExecutionEngine.instance;
  }

  public getExecutorForNetwork(network: string): ITradeExecutor {
    this.mode = network;
    return this;
  }

  public async getQuote(params: any): Promise<any> {
    return {
      inputMint: params?.inputMint || '',
      outputMint: params?.outputMint || '',
      inAmount: String(params?.amount || '0'),
      outAmount: String(params?.amount || '0'),
    };
  }

  public async executeSwap(quote: any, _keypair?: any): Promise<SwapResult> {
    try {
      const isBuy = quote.isBuy ?? (quote.side === 'buy');
      if (isBuy) {
        const res = await tradingEngine.buy({
          network: this.mode,
          mint: quote.outputMint || quote.mint,
          amountSol: Number(quote.amountSol || (Number(quote.inAmount) / 1e9)) || 0.1,
          slippageBps: quote.slippageBps || 250,
        });
        return {
          success: res.success ?? false,
          signature: res.signature,
          error: res.error,
          inputAmount: quote.inAmount,
          outputAmount: quote.outAmount,
        };
      } else {
        const res = await tradingEngine.sell({
          network: this.mode,
          mint: quote.inputMint || quote.mint,
          amountRaw: quote.inAmount || quote.amountRaw,
          slippageBps: quote.slippageBps || 300,
        });
        return {
          success: res.success ?? false,
          signature: res.signature,
          error: res.error,
          inputAmount: quote.inAmount,
          outputAmount: quote.outAmount,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Swap execution failed',
      };
    }
  }

  public async batchSwap(quotes: any[]): Promise<SwapResult[]> {
    return Promise.all(quotes.map(q => this.executeSwap(q)));
  }

  public async getSolBalance(_address?: string): Promise<number> {
    return 0;
  }

  public async getTokenBalance(_mintOrAddress: string, _mint?: string): Promise<any> {
    return 0;
  }

  public async hasTokenAccount(_mintOrAddress: string, _mint?: string): Promise<boolean> {
    return true;
  }

  public getTelemetry(): ExecutorTelemetry {
    return {
      totalSwaps: 0,
      successfulSwaps: 0,
      failedSwaps: 0,
      avgLatencyMs: 0,
    };
  }
}

export const executionEngine = ExecutionEngine.getInstance();
