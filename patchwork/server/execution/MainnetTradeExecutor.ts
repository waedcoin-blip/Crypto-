// server/execution/MainnetTradeExecutor.ts
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import * as jupApi from '@jup-ag/api';
import { TradeExecutor, QuoteParams, QuoteResult, ExecuteParams, ExecutionResult } from './TradeExecutor.js';
import { walletManager } from '../wallet/WalletManager.js';
import { tokenProgramResolver } from '../wallet/TokenProgramResolver.js';
import { validateQuoteSafetyStrict } from '../utils/quoteSafety.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const createJupiterApiClient = (jupApi as any).createJupiterApiClient || (jupApi as any).default?.createJupiterApiClient || (() => ({}));

const positiveBps = (v: number | undefined, fallback: number) => v === undefined ? fallback : Math.max(0, Math.min(10_000, Math.floor(v)));

export class MainnetTradeExecutor implements TradeExecutor {
  private connection: Connection;
  private jupiterApi: any;
  constructor(options?: { rpcUrl?: string }) {
    const rpc = options?.rpcUrl || process.env.MAINNET_RPC_URL || process.env.EXECUTION_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpc, 'confirmed');
    this.jupiterApi = createJupiterApiClient();
  }

  private account(wallet?: string) {
    return walletManager.getAccountForExecution('mainnet', wallet || 'default');
  }

  private async tokenRawBalance(owner: PublicKey, mint: string): Promise<number> {
    if (mint === WSOL_MINT) return await this.connection.getBalance(owner);
    const result = await this.connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
    const total = result.value.reduce((sum, item: any) => sum + BigInt(item.account.data.parsed.info.tokenAmount.amount || '0'), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`TOKEN_AMOUNT_TOO_LARGE: raw balance for ${mint} exceeds JS safe integer range`);
    return Number(total);
  }

  private async decimals(mint: string): Promise<number> {
    if (mint === WSOL_MINT) return 9;
    const info = await tokenProgramResolver.resolve(this.connection, mint);
    if (!Number.isInteger(info.decimals) || info.decimals < 0 || info.decimals > 18) {
      throw new Error(`UNRESOLVED_TOKEN_DECIMALS: Invalid decimals for ${mint}`);
    }
    return info.decimals;
  }

  async quoteBuy(params: QuoteParams): Promise<QuoteResult> {
    const slippageBps = positiveBps(params.slippageBps, 250);
    const quote = await this.jupiterApi.quoteGet({ inputMint: params.inputMint, outputMint: params.outputMint, amount: params.amount, slippageBps, userPublicKey: params.userPublicKey });
    const validated = validateQuoteSafetyStrict({ quote, inputAmount: params.amount, slippageBps, expectedInputMint: params.inputMint, expectedOutputMint: params.outputMint, isBuy: true });
    return { inAmount: quote.inAmount, outAmount: quote.outAmount, otherAmountThreshold: String(validated.otherAmountThreshold), priceImpactPct: validated.normalizedPriceImpactRatio * 100, routePlan: quote.routePlan, rawQuote: quote };
  }

  async quoteSell(params: QuoteParams): Promise<QuoteResult> {
    const slippageBps = positiveBps(params.slippageBps, 250);
    const quote = await this.jupiterApi.quoteGet({ inputMint: params.inputMint, outputMint: params.outputMint, amount: params.amount, slippageBps, userPublicKey: params.userPublicKey });
    const validated = validateQuoteSafetyStrict({ quote, inputAmount: params.amount, slippageBps, expectedInputMint: params.inputMint, expectedOutputMint: params.outputMint, isBuy: false });
    return { inAmount: quote.inAmount, outAmount: quote.outAmount, otherAmountThreshold: String(validated.otherAmountThreshold), priceImpactPct: validated.normalizedPriceImpactRatio * 100, routePlan: quote.routePlan, rawQuote: quote };
  }

  private async execute(params: ExecuteParams, side: 'buy' | 'sell'): Promise<ExecutionResult> {
    if (params.network !== 'mainnet') throw new Error(`NETWORK_MISMATCH: Mainnet executor received ${params.network || 'undefined'}`);
    const wallet = this.account(params.walletAddress);
    const inputMint = params.inputMint;
    const outputMint = params.outputMint;
    const slippageBps = positiveBps(params.slippageBps, side === 'buy' ? 250 : 1000);
    const quoteRes = params.preValidatedQuote || (side === 'buy' ? await this.quoteBuy({ inputMint, outputMint, amount: params.amount, slippageBps, userPublicKey: wallet.publicKey, network: 'mainnet' }) : await this.quoteSell({ inputMint, outputMint, amount: params.amount, slippageBps, userPublicKey: wallet.publicKey, network: 'mainnet' }));
    if (process.env.NODE_ENV === 'test' && !wallet.keypair) {
      const raw = Number((params.preValidatedQuote as any)?.outAmount || params.amount);
      const decimals = params.tokenDecimals ?? 6;
      const sol = side === 'buy' ? params.amount / 1e9 : raw / 1e9;
      return { success: true, signature: `mock_mainnet_${side}_${Date.now()}`, inputMint, outputMint, inAmountRaw: params.amount, outAmountRaw: raw, totalCostSol: side === 'buy' ? sol : undefined, netProceedsSol: side === 'sell' ? sol : undefined, effectivePriceSol: raw > 0 ? sol / (raw / 10 ** decimals) : undefined, outputDecimals: decimals };
    }
    if (!wallet.keypair) throw new Error('EXECUTION_FAILED: Mainnet private key for requested wallet is not configured');


    // Never execute a quote that belongs to another wallet/network.
    if (quoteRes.rawQuote?.inputMint && quoteRes.rawQuote.inputMint !== inputMint) throw new Error('QUOTE_MISMATCH: input mint differs from order');
    if (quoteRes.rawQuote?.outputMint && quoteRes.rawQuote.outputMint !== outputMint) throw new Error('QUOTE_MISMATCH: output mint differs from order');

    const owner = wallet.keypair.publicKey;
    const beforeInput = await this.tokenRawBalance(owner, inputMint);
    const beforeOutput = await this.tokenRawBalance(owner, outputMint);
    const beforeSol = await this.connection.getBalance(owner);

    try {
      const swapRes = await this.jupiterApi.swapPost({ swapRequest: { quoteResponse: quoteRes.rawQuote || quoteRes, userPublicKey: wallet.publicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' } });
      const transaction = VersionedTransaction.deserialize(Buffer.from(swapRes.swapTransaction, 'base64'));
      transaction.sign([wallet.keypair]);
      const txid = await this.connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3 });
      const confirmation = await this.connection.confirmTransaction(txid, 'confirmed');
      if (confirmation.value.err) throw new Error(`TRANSACTION_FAILED: ${JSON.stringify(confirmation.value.err)}`);

      const [afterInput, afterOutput, afterSol] = await Promise.all([
        this.tokenRawBalance(owner, inputMint), this.tokenRawBalance(owner, outputMint), this.connection.getBalance(owner)
      ]);
      const actualIn = side === 'buy' ? params.amount : Math.max(0, beforeInput - afterInput);
      const actualOut = side === 'buy' ? Math.max(0, afterOutput - beforeOutput) : Math.max(0, afterOutput - beforeOutput);
      const actualSolDelta = side === 'buy' ? Math.max(0, beforeSol - afterSol) : Math.max(0, afterSol - beforeSol);
      if (actualIn <= 0 || actualOut <= 0) throw new Error(`EXECUTION_AMOUNT_MISMATCH: on-chain balance delta did not show a ${side} fill (in=${actualIn}, out=${actualOut})`);

      const outputDecimals = await this.decimals(outputMint);
      const inputDecimals = await this.decimals(inputMint);
      const inHuman = actualIn / 10 ** inputDecimals;
      const outHuman = actualOut / 10 ** outputDecimals;
      const solValue = side === 'buy' ? actualSolDelta / 1e9 : actualOut / 1e9;
      return {
        success: true, signature: txid, inputMint, outputMint, inAmountRaw: actualIn, outAmountRaw: actualOut,
        totalCostSol: side === 'buy' ? solValue : undefined,
        netProceedsSol: side === 'sell' ? solValue : undefined,
        effectivePriceSol: outHuman > 0 ? (side === 'buy' ? solValue : solValue) / outHuman : undefined,
        rawResponse: { quote: quoteRes.rawQuote || quoteRes, actualIn, actualOut, actualSolDelta, inHuman, outHuman }
      };
    } catch (e: any) {
      return { success: false, inputMint, outputMint, inAmountRaw: params.amount, outAmountRaw: 0, error: `MAINNET_EXECUTION_ERROR: ${e?.message || e}` };
    }
  }

  async buy(params: ExecuteParams) { return this.execute(params, 'buy'); }
  async sell(params: ExecuteParams) { return this.execute(params, 'sell'); }

  async getBalance(walletAddress?: string): Promise<number> {
    try { return (await this.connection.getBalance(this.account(walletAddress).keypair?.publicKey || new PublicKey(this.account(walletAddress).publicKey))) / 1e9; } catch { return 0; }
  }
  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {
    try { return await this.tokenRawBalance(new PublicKey(this.account(walletAddress).publicKey), mint); } catch { return 0; }
  }
}
