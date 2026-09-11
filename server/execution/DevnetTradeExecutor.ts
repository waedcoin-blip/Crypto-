// server/execution/DevnetTradeExecutor.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { TradeExecutor, QuoteParams, QuoteResult, ExecuteParams, ExecutionResult } from './TradeExecutor.js';
import { walletManager } from '../wallet/WalletManager.js';
import { tokenProgramResolver } from '../wallet/TokenProgramResolver.js';
import { rawToUiNumber, applySlippageBps } from '../utils/rawAmount.js';

export class DevnetTradeExecutor implements TradeExecutor {
  public readonly network: string = 'devnet';
  private connection: Connection;
  private defaultWalletIdentity: string;

  constructor(options?: { rpcUrl?: string; walletIdentity?: string }) {
    const rpc = options?.rpcUrl || process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpc, 'confirmed');
    this.defaultWalletIdentity = options?.walletIdentity || 'devnet:wallet_a';
  }

  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    const amountNum = Number(params.amount);
    const simulatedTokensRaw = Math.floor(amountNum * 500_000); // Devnet swap simulation
    const slippage = params.slippageBps ? params.slippageBps / 10000 : 0.05;
    const minThreshold = applySlippageBps(BigInt(simulatedTokensRaw), Math.round(slippage * 10000));

    return {
      success: true,
      quote: {
        inAmount: String(params.amount),
        outAmount: String(simulatedTokensRaw),
        otherAmountThreshold: String(minThreshold),
        priceImpactPct: 0.005,
        routePlan: [{ swapInfo: { ammKey: 'DevnetAMM' } }],
      },
      outAmountLamports: simulatedTokensRaw,
      outAmountRaw: String(simulatedTokensRaw),
      priceImpactPct: 0.005,
      routePlanLength: 1,
    };
  }

  async buy(params: ExecuteParams): Promise<ExecutionResult> {
    const quoteResult = params.preValidatedQuote
      ? { success: true, quote: params.preValidatedQuote }
      : await this.getQuote({
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: params.slippageBps,
        });

    const quote = quoteResult.quote || {};
    const tokenReceivedRaw = quote.outAmount || String(params.amount);
    const amountNum = Number(params.amount);
    const solSpent = amountNum / 1e9;

    return {
      success: true,
      signature: `devnet_tx_buy_${Date.now()}_${params.outputMint.slice(0, 6)}`,
      outAmountRaw: tokenReceivedRaw,
      outAmountLamports: Number(tokenReceivedRaw) || 0,
      durationMs: 100,
    };
  }

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    const quoteResult = params.preValidatedQuote
      ? { success: true, quote: params.preValidatedQuote }
      : await this.getQuote({
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: params.slippageBps,
        });

    const quote = quoteResult.quote || {};
    const solGainedLamports = quote.outAmount || String(params.amount);

    return {
      success: true,
      signature: `devnet_tx_sell_${Date.now()}_${params.inputMint.slice(0, 6)}`,
      outAmountRaw: solGainedLamports,
      outAmountLamports: Number(solGainedLamports) || 0,
      durationMs: 100,
    };
  }

  async getSolBalance(walletAddress?: string): Promise<number> {
    const walletIdentity = walletAddress ? `devnet:${walletAddress}` : this.defaultWalletIdentity;
    const account = walletManager.getAccount(walletIdentity);
    if (!account || !account.keypair) return 10.0;
    try {
      const lamports = await this.connection.getBalance(account.keypair.publicKey);
      return lamports / 1e9;
    } catch {
      return 10.0;
    }
  }

  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {
    const walletIdentity = walletAddress ? `devnet:${walletAddress}` : this.defaultWalletIdentity;
    const account = walletManager.getAccount(walletIdentity);
    if (!account || !account.keypair) return 0;

    try {
      const info = await tokenProgramResolver.resolve(this.connection, mint);
      const ata = tokenProgramResolver.getAtaAddress(account.keypair.publicKey, new PublicKey(mint), info.programId);
      const balanceRes = await this.connection.getTokenAccountBalance(ata);
      return Number(balanceRes.value.amount || 0);
    } catch {
      return 0;
    }
  }

  async verifyReadiness(): Promise<{ ready: boolean; reason?: string }> {
    return { ready: true };
  }
}
