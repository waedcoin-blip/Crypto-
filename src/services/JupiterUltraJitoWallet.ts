// src/services/JupiterUltraJitoWallet.ts
import {
  Connection,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { createJupiterApiClient, QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import bs58 from 'bs58';

export interface JupiterUltraConfig {
  rpcEndpoint: string;
  jupiterEndpoint: string;
  jupiterApiKey: string;
  privateKeyBase58: string;
  jitoEndpoints: string[];
  heliusRpcUrl: string;
  defaultJitoTipSol: number;
  minJitoTipSol: number;
  maxJitoTipSol: number;
  verbose?: boolean;
}

export class JupiterUltraJitoWallet {
  public connection: Connection;
  public jupiterApi: ReturnType<typeof createJupiterApiClient>;
  public wallet: Keypair;
  public publicKey: PublicKey;
  public config: JupiterUltraConfig;
  private recentTips: number[] = [];
  private readonly TIP_WINDOW_SIZE = 20;

  constructor(config: JupiterUltraConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    this.jupiterApi = createJupiterApiClient({ basePath: config.jupiterEndpoint });
    this.wallet = Keypair.fromSecretKey(bs58.decode(config.privateKeyBase58));
    this.publicKey = this.wallet.publicKey;
  }

  private log(...args: any[]) {
    if (this.config.verbose) console.log('[JupiterUltraJito]', ...args);
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    const url = new URL(`${this.config.jupiterEndpoint}/quote`);
    url.searchParams.set('inputMint', params.inputMint);
    url.searchParams.set('outputMint', params.outputMint);
    url.searchParams.set('amount', String(params.amount));
    url.searchParams.set(
      'restrictIntermediateTokens',
      String(params.restrictIntermediateTokens ?? true)
    );
    url.searchParams.set(
      'onlyDirectRoutes',
      String((params as any).onlyDirectRoutes ?? false)
    );
    if (params.slippageBps) url.searchParams.set('slippageBps', String(params.slippageBps));

    const res = await fetch(url.toString(), {
      headers: { 'x-api-key': this.config.jupiterApiKey },
    });
    if (!res.ok) throw new Error(`Quote failed (${res.status}): ${await res.text()}`);
    return res.json();
  }

  async buildSwapTransaction(
    quote: any,
    options?: {
      slippageBps?: number;
      dynamicComputeUnitLimit?: boolean;
      jitoTipLamports?: number;
      priorityFeeLamports?: number;
    }
  ) {
    const body: any = {
      quoteResponse: quote,
      userPublicKey: this.publicKey.toBase58(),
      dynamicComputeUnitLimit: options?.dynamicComputeUnitLimit ?? true,
    };
    if (options?.jitoTipLamports) {
      body.prioritizationFeeLamports = { jitoTipLamports: options.jitoTipLamports };
    } else if (options?.priorityFeeLamports) {
      body.prioritizationFeeLamports = options.priorityFeeLamports;
    }
    if (options?.slippageBps) body.slippageBps = options.slippageBps;

    const res = await fetch(`${this.config.jupiterEndpoint}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.jupiterApiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Swap build failed (${res.status}): ${await res.text()}`);
    return res.json();
  }

  async signTransaction(base64Tx: string): Promise<VersionedTransaction> {
    const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, 'base64'));
    const alts = await this.resolveALTs(tx);
    const lbh = await this.connection.getLatestBlockhash();
    const msg = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: alts });
    msg.payerKey = this.publicKey;
    msg.recentBlockhash = lbh.blockhash;

    const compiled = msg.compileToV0Message(alts);
    const signed = new VersionedTransaction(compiled);
    signed.sign([this.wallet]);
    return signed;
  }

  async submitJitoBundle(signedTx: VersionedTransaction, tipLamports: number) {
    const serialized = Buffer.from(signedTx.serialize()).toString('base64');
    const payloads = this.config.jitoEndpoints.map(() => ({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [[serialized]],
    }));

    const results = await Promise.allSettled(
      payloads.map(async (payload, idx) => {
        const res = await fetch(this.config.jitoEndpoints[idx], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.error) throw new Error(JSON.stringify(json.error));
        return json.result as string;
      })
    );

    for (const r of results) if (r.status === 'fulfilled') return r.value;
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason.message);
    throw new Error(`Jito relays failed: ${errors.join(' | ')}`);
  }

  calibrateTip(lastTipSol: number, landed: boolean): number {
    let newTip = lastTipSol;
    if (!landed) newTip = Math.min(lastTipSol * 1.2, this.config.maxJitoTipSol);
    else if (this.recentTips.length >= this.TIP_WINDOW_SIZE) {
      const avg = this.recentTips.reduce((a, b) => a + b, 0) / this.recentTips.length;
      newTip = Math.max(avg * 0.95, this.config.minJitoTipSol);
    }
    this.recentTips.push(newTip);
    if (this.recentTips.length > this.TIP_WINDOW_SIZE) this.recentTips.shift();
    return newTip;
  }

  getRecommendedTip(): number {
    return this.config.defaultJitoTipSol;
  }

  async executeSwap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps = 50
  ) {
    const quote = await this.getQuote({ inputMint, outputMint, amount, slippageBps });
    const tip = this.getRecommendedTip();
    const tipLamports = Math.floor(tip * LAMPORTS_PER_SOL);
    const { swapTransaction } = await this.buildSwapTransaction(quote, {
      jitoTipLamports: tipLamports,
      dynamicComputeUnitLimit: true,
    });
    const signed = await this.signTransaction(swapTransaction);
    const bundleId = await this.submitJitoBundle(signed, tipLamports);
    const slot = await this.confirmJitoBundle(bundleId);
    return { signature: bundleId, quote, tipLamports, slot };
  }

  private async resolveALTs(tx: VersionedTransaction) {
    if (tx.message.addressTableLookups.length === 0) return [];
    const results = await Promise.all(
      tx.message.addressTableLookups.map(l =>
        this.connection.getAddressLookupTable(l.accountKey)
      )
    );
    return results.map(r => r.value).filter(Boolean) as AddressLookupTableAccount[];
  }

  private async confirmJitoBundle(bundleId: string, timeoutMs = 30000): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const ep of this.config.jitoEndpoints) {
        try {
          const res = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'getBundleStatuses',
              params: [[bundleId]],
            }),
          });
          const json = await res.json();
          const status = json.result?.value?.[0];
          if (
            status?.confirmationStatus === 'confirmed' ||
            status?.confirmationStatus === 'finalized'
          ) {
            if (!status.err) return status.slot;
            throw new Error(`Bundle failed: ${JSON.stringify(status.err)}`);
          }
        } catch {}
      }
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('Jito confirmation timeout');
  }

  async getSolBalance(): Promise<number> {
    const lamports = await this.connection.getBalance(this.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }
}
