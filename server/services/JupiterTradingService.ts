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
    const amtNum = typeof params.amount === 'bigint' ? Number(params.amount) : Number(params.amount);
    const res = await executor.quoteBuy({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: amtNum,
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

  public async createSwapTransaction(quoteResponse: any, userPublicKey: string) {
    const apiKey = this.getApiKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const res = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Jupiter Swap Transaction Failed [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    return data.swapTransaction;
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
      amount: Number(params.quoteResponse?.inAmount || 0),
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
