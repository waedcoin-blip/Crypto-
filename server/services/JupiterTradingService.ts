// server/services/JupiterTradingService.ts
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

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
    const apiKey = this.getApiKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const amountStr = typeof params.amount === 'bigint' ? params.amount.toString() : String(params.amount);
    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${encodeURIComponent(params.inputMint)}&outputMint=${encodeURIComponent(params.outputMint)}&amount=${encodeURIComponent(amountStr)}&slippageBps=${params.slippageBps || 250}`;

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

  public async executeSwap(params: {
    quoteResponse: any;
    walletPrivateKey: string;
    rpcUrl?: string;
  }): Promise<{ signature: string; outAmountLamports?: string }> {
    const rawPrivateKey = params.walletPrivateKey.trim();
    let keypair: Keypair;

    if (rawPrivateKey.startsWith('[') && rawPrivateKey.endsWith(']')) {
      keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rawPrivateKey)));
    } else {
      keypair = Keypair.fromSecretKey(bs58.decode(rawPrivateKey));
    }

    const userPublicKey = keypair.publicKey.toBase58();
    const swapTransactionBase64 = await this.createSwapTransaction(params.quoteResponse, userPublicKey);

    const swapTransactionBuf = Buffer.from(swapTransactionBase64, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([keypair]);

    const rpcUrl = params.rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    const rawTransaction = transaction.serialize();
    const signature = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 3,
    });

    const latestBlockHash = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      {
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature,
      },
      'confirmed'
    );

    return {
      signature,
      outAmountLamports: params.quoteResponse?.outAmount,
    };
  }
}

export const jupiterTradingService = JupiterTradingService.getInstance();
