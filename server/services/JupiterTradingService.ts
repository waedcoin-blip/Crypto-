// server/services/JupiterTradingService.ts
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

export interface JupiterSwapParams {
  inputMint: string;
  outputMint: string;
  amount: number; // raw lamports or token units
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
    amount: number;
    slippageBps?: number;
  }) {
    const apiKey = this.getApiKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${encodeURIComponent(params.inputMint)}&outputMint=${encodeURIComponent(params.outputMint)}&amount=${params.amount}&slippageBps=${params.slippageBps || 250}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Jupiter Quote Failed [${res.status}]: ${errText}`);
    }

    return await res.json();
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
}

export const jupiterTradingService = JupiterTradingService.getInstance();
