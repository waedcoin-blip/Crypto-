// server/execution/DevnetTradeExecutor.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { TradeExecutor, QuoteParams, QuoteResult, ExecuteParams, ExecutionResult } from './TradeExecutor.js';
import { walletManager } from '../wallet/WalletManager.js';
import { tokenProgramResolver } from '../wallet/TokenProgramResolver.js';

export class DevnetTradeExecutor implements TradeExecutor {
  private connection: Connection;
  private defaultWalletIdentity: string;

  constructor(options?: { rpcUrl?: string; walletIdentity?: string }) {
    const rpc = options?.rpcUrl || process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpc, 'confirmed');
    this.defaultWalletIdentity = options?.walletIdentity || 'devnet:wallet_a';
  }

  async quoteBuy(params: QuoteParams): Promise<QuoteResult> {
    const amountNum = Number(params.amount);
    const solAmount = amountNum / 1e9;
    const decs = params.decimals;
    if (decs === undefined) {
      throw new Error('Decimals must be provided for quote');
    }
    const simulatedTokensRaw = Math.floor(solAmount * 500_000 * (10 ** decs)); // Devnet swap simulation
    const slippage = params.slippageBps ? params.slippageBps / 10000 : 0.05;
    const minThreshold = Math.floor(simulatedTokensRaw * (1 - slippage));

    return {
      inAmount: String(params.amount),
      outAmount: String(simulatedTokensRaw),
      otherAmountThreshold: String(minThreshold),
      priceImpactPct: 0.005,
      routePlan: [{ swapInfo: { ammKey: 'DevnetAMM' } }],
    };
  }

  async quoteSell(params: QuoteParams): Promise<QuoteResult> {
    const decs = params.decimals;
    if (decs === undefined) {
      throw new Error('Decimals must be provided for quote');
    }
    const amountNum = Number(params.amount);
    const tokenQty = amountNum / (10 ** decs);
    const solProceeds = tokenQty * 0.000002;
    const lamports = Math.floor(solProceeds * 1e9);
    const slippage = params.slippageBps ? params.slippageBps / 10000 : 0.05;
    const minThreshold = Math.floor(lamports * (1 - slippage));

    return {
      inAmount: String(params.amount),
      outAmount: String(lamports),
      otherAmountThreshold: String(minThreshold),
      priceImpactPct: 0.005,
      routePlan: [{ swapInfo: { ammKey: 'DevnetAMM' } }],
    };
  }

  async buy(params: ExecuteParams): Promise<ExecutionResult> {
    const walletIdentity = params.walletAddress ? `devnet:${params.walletAddress}` : this.defaultWalletIdentity;
    const walletAccount = walletManager.getAccount(walletIdentity);

    const quote = params.preValidatedQuote || (await this.quoteBuy({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      decimals: params.decimals,
      slippageBps: params.slippageBps,
    }));

    const tokenProgramInfo = await tokenProgramResolver.resolve(this.connection, params.outputMint);
    const tokenReceivedRaw = quote.outAmount;
    const amountNum = Number(params.amount);
    const solSpent = amountNum / 1e9;
    const tokenQty = Number(tokenReceivedRaw) / (10 ** tokenProgramInfo.decimals);
    const effectivePrice = tokenQty > 0 ? solSpent / tokenQty : 0;

    return {
      success: true,
      signature: `devnet_tx_buy_${Date.now()}_${params.outputMint.slice(0, 6)}`,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmountRaw: String(params.amount),
      outAmountRaw: tokenReceivedRaw,
      totalCostSol: solSpent,
      effectivePriceSol: effectivePrice,
    };
  }

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    const walletIdentity = params.walletAddress ? `devnet:${params.walletAddress}` : this.defaultWalletIdentity;
    const walletAccount = walletManager.getAccount(walletIdentity);

    const quote = params.preValidatedQuote || (await this.quoteSell({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      decimals: params.decimals,
      slippageBps: params.slippageBps,
    }));

    const solGainedLamports = quote.outAmount;
    const solGained = Number(solGainedLamports) / 1e9;

    return {
      success: true,
      signature: `devnet_tx_sell_${Date.now()}_${params.inputMint.slice(0, 6)}`,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmountRaw: String(params.amount),
      outAmountRaw: solGainedLamports,
      netProceedsSol: solGained,
    };
  }

  async getBalance(walletAddress?: string): Promise<number> {
    const walletIdentity = walletAddress ? `devnet:${walletAddress}` : this.defaultWalletIdentity;
    const account = walletManager.getAccount(walletIdentity);
    if (!account.keypair) return 10.0; // Fallback mock devnet balance if no key
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
    if (!account.keypair) return 0;

    try {
      const info = await tokenProgramResolver.resolve(this.connection, mint);
      const ata = tokenProgramResolver.getAtaAddress(account.keypair.publicKey, new PublicKey(mint), info.programId);
      const balanceRes = await this.connection.getTokenAccountBalance(ata);
      return Number(balanceRes.value.amount || 0);
    } catch {
      return 0;
    }
  }
}
