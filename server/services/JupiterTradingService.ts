// server/services/JupiterTradingService.ts
import { executionGateway } from '../execution/ExecutionGateway.js';

export interface JupiterSwapParams {
  inputMint: string;
  outputMint: string;
  amount: number | string | bigint; // raw lamports or token units
  slippageBps: number;
  userPublicKey?: string;
  privateKey?: string;
}

/**
 * JupiterTradingService: Internal utility for quote queries and delegation to ExecutionGateway.
 * Direct blockchain submission is strictly delegated to the single authoritative ExecutionGateway.
 */
export class JupiterTradingService {
  private static instance: JupiterTradingService;

  public static getInstance(): JupiterTradingService {
    if (!JupiterTradingService.instance) {
      JupiterTradingService.instance = new JupiterTradingService();
    }
    return JupiterTradingService.instance;
  }

  public getApiKey(): string | undefined {
    return process.env.JUPITER_API_KEY;
  }

  public async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: number | string | bigint;
    slippageBps?: number;
  }) {
    const executor = executionGateway.getExecutor('mainnet');
    const res = await executor.quoteBuy({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps,
      network: 'mainnet',
    });
    return res.rawQuote || {
      inAmount: res.inAmount,
      outAmount: res.outAmount,
      otherAmountThreshold: res.otherAmountThreshold,
      priceImpactPct: res.priceImpactPct,
      routePlan: res.routePlan,
    };
  }

  public async executeSwap(params: {
    quoteResponse: any;
    walletPrivateKey?: string;
    rpcUrl?: string;
    network?: string;
  }): Promise<{ signature: string; outAmountLamports?: string }> {
    const net = params.network || 'mainnet';
    const executor = executionGateway.getExecutor(net);
    const isSolInput = params.quoteResponse?.inputMint === 'So11111111111111111111111111111111111111112';
    
    const execParams = {
      inputMint: params.quoteResponse?.inputMint || 'So11111111111111111111111111111111111111112',
      outputMint: params.quoteResponse?.outputMint || '',
      amount: String(params.quoteResponse?.inAmount || '0'),
      slippageBps: params.quoteResponse?.slippageBps || 250,
      decimals: 9,
      network: net,
      preValidatedQuote: params.quoteResponse,
    };

    const res = isSolInput ? await executor.buy(execParams) : await executor.sell(execParams);
    if (!res.success || !res.signature) {
      throw new Error(`EXECUTION_AUTHORITY_FAILED: ${res.error || 'Execution via ExecutionGateway failed'}`);
    }

    return {
      signature: res.signature,
      outAmountLamports: String(res.outAmountRaw),
    };
  }
}

export const jupiterTradingService = JupiterTradingService.getInstance();
