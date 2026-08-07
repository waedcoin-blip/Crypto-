// src/services/BracketOrderManager.ts
import {
  Connection,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import bs58 from 'bs58';
import { JupiterUltraJitoWallet } from './JupiterUltraJitoWallet';

export type BracketSide = 'tp' | 'sl';

export interface BracketPosition {
  mint: string;
  amount: number;
  solSpent: number;
  tpPct: number;
  slPct: number;
  vaultPubkey: string;
  profitSharePct: number;
}

export interface PrebuiltSwap {
  side: BracketSide;
  quoteResponse: any;
  swapTransactionBase64: string;
  triggerPriceSol: number;
  estimatedOutputSol: number;
  builtAt: number;
}

export interface AtomicBundleResult {
  bundleId: string;
  side: BracketSide;
  exitSignature: string;
  feeTransferSignature: string;
  slot: number;
  netSolToWallet: number;
  profitShared: number;
  landingTimeMs: number;
}

export class BracketOrderManager {
  public connection: Connection;
  public wallet: Keypair;
  public publicKey: PublicKey;
  public jupiterApi: ReturnType<typeof createJupiterApiClient>;
  private jitoWallet: JupiterUltraJitoWallet;
  private prebuiltSwaps = new Map<string, PrebuiltSwap>();

  constructor(
    jupiterEndpoint: string,
    jupiterApiKey: string,
    privateKeyBase58: string,
    rpcEndpoint: string,
    jitoWallet: JupiterUltraJitoWallet
  ) {
    this.connection = new Connection(rpcEndpoint, 'confirmed');
    this.jupiterApi = createJupiterApiClient({ basePath: jupiterEndpoint });
    this.wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.publicKey = this.wallet.publicKey;
    this.jitoWallet = jitoWallet;
  }

  async prebuildBracketOrders(pos: BracketPosition): Promise<void> {
    const WSOL = 'So11111111111111111111111111111111111111112';

    // TP: 2% slippage ceiling
    const tpQuote = await this.jupiterApi.quoteGet({
      inputMint: pos.mint,
      outputMint: WSOL,
      amount: pos.amount,
      slippageBps: 200,
      restrictIntermediateTokens: true,
    });

    const tpSwap = await this.jupiterApi.swapPost({
      swapRequest: {
        quoteResponse: tpQuote,
        userPublicKey: this.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { jitoTipLamports: 0 } as any,
      },
    });

    this.prebuiltSwaps.set(`${pos.mint}-tp`, {
      side: 'tp',
      quoteResponse: tpQuote,
      swapTransactionBase64: tpSwap.swapTransaction,
      triggerPriceSol: (pos.solSpent * (1 + pos.tpPct / 100)) / pos.amount,
      estimatedOutputSol: Number(tpQuote.outAmount) / 1e9,
      builtAt: Date.now(),
    });

    // SL: 10% slippage ceiling (must fill)
    const slQuote = await this.jupiterApi.quoteGet({
      inputMint: pos.mint,
      outputMint: WSOL,
      amount: pos.amount,
      slippageBps: 1000,
      restrictIntermediateTokens: true,
    });

    const slSwap = await this.jupiterApi.swapPost({
      swapRequest: {
        quoteResponse: slQuote,
        userPublicKey: this.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { jitoTipLamports: 0 } as any,
      },
    });

    this.prebuiltSwaps.set(`${pos.mint}-sl`, {
      side: 'sl',
      quoteResponse: slQuote,
      swapTransactionBase64: slSwap.swapTransaction,
      triggerPriceSol: (pos.solSpent * (1 - pos.slPct / 100)) / pos.amount,
      estimatedOutputSol: Number(slQuote.outAmount) / 1e9,
      builtAt: Date.now(),
    });
  }

  checkTrigger(
    pos: BracketPosition,
    currentPriceSol: number
  ): BracketSide | 'stale' | null {
    const tp = this.prebuiltSwaps.get(`${pos.mint}-tp`);
    const sl = this.prebuiltSwaps.get(`${pos.mint}-sl`);
    if (!tp || !sl) return null;
    if (Date.now() - tp.builtAt > 30000 || Date.now() - sl.builtAt > 30000) return 'stale';

    if (currentPriceSol >= tp.triggerPriceSol) return 'tp';
    if (currentPriceSol <= sl.triggerPriceSol) return 'sl';
    return null;
  }

  async executeAtomicExit(
    pos: BracketPosition,
    side: BracketSide,
    jitoTipSol: number
  ): Promise<AtomicBundleResult> {
    const prebuilt = this.prebuiltSwaps.get(`${pos.mint}-${side}`)!;
    const startTime = Date.now();
    const lbh = await this.connection.getLatestBlockhash();

    // Tx 1: Jupiter Exit Swap
    const swapTx = VersionedTransaction.deserialize(
      Buffer.from(prebuilt.swapTransactionBase64, 'base64')
    );
    const alts = await this.resolveALTs(swapTx);
    const swapMsg = TransactionMessage.decompile(swapTx.message, { addressLookupTableAccounts: alts });
    swapMsg.payerKey = this.publicKey;
    swapMsg.recentBlockhash = lbh.blockhash;

    const compiledSwap = swapMsg.compileToV0Message(alts);
    const signedSwap = new VersionedTransaction(compiledSwap);
    signedSwap.sign([this.wallet]);

    const bundle: VersionedTransaction[] = [signedSwap];

    // Tx 2: Profit/Fee Transfer (uses slippage-protected minimum)
    const minOutLamports = Number(prebuilt.quoteResponse.otherAmountThreshold);
    const solSpentLamports = Math.floor(pos.solSpent * LAMPORTS_PER_SOL);
    const grossProfit = Math.max(0, minOutLamports - solSpentLamports);
    const feeShare = Math.floor(grossProfit * (pos.profitSharePct / 100));

    if (feeShare > 5000) {
      const balance = await this.connection.getBalance(this.publicKey);
      const tipLamports = Math.floor(jitoTipSol * LAMPORTS_PER_SOL);
      if (balance >= feeShare + tipLamports + 5000) {
        const feeMsg = new TransactionMessage({
          payerKey: this.publicKey,
          recentBlockhash: lbh.blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: this.publicKey,
              toPubkey: new PublicKey(pos.vaultPubkey),
              lamports: feeShare,
            }),
          ],
        }).compileToV0Message();
        const feeTx = new VersionedTransaction(feeMsg);
        feeTx.sign([this.wallet]);
        bundle.push(feeTx);
      }
    }

    // Tx 3: Jito Tip (always last)
    const tipLamports = Math.floor(jitoTipSol * LAMPORTS_PER_SOL);
    const tipAccounts = [
      '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
      'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
      'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMYXKw7QoxYKD2h9p',
      'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
      'DfXygSm4jCyRCybV98g3K7ErfS82pfBahsVTaDzkoKAW',
      'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
      'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
      '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    ].map(a => new PublicKey(a));

    const tipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
    const tipMsg = new TransactionMessage({
      payerKey: this.publicKey,
      recentBlockhash: lbh.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: this.publicKey,
          toPubkey: tipAccount,
          lamports: tipLamports,
        }),
      ],
    }).compileToV0Message();

    const tipTx = new VersionedTransaction(tipMsg);
    tipTx.sign([this.wallet]);
    bundle.push(tipTx);

    // Submit
    const bundleId = await this.submitBundle(bundle);
    const slot = await this.confirmBundle(bundleId);

    return {
      bundleId,
      side,
      exitSignature: signedSwap.signatures[0] ? bs58.encode(signedSwap.signatures[0]) : '',
      feeTransferSignature:
        bundle.length > 2 && bundle[1].signatures[0]
          ? bs58.encode(bundle[1].signatures[0])
          : '',
      slot,
      netSolToWallet: (minOutLamports - feeShare) / LAMPORTS_PER_SOL,
      profitShared: feeShare / LAMPORTS_PER_SOL,
      landingTimeMs: Date.now() - startTime,
    };
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

  private async submitBundle(txs: VersionedTransaction[]): Promise<string> {
    const serialized = txs.map(tx => Buffer.from(tx.serialize()).toString('base64'));
    const results = await Promise.allSettled(
      this.jitoWallet.config.jitoEndpoints.map(async endpoint => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendBundle',
            params: [serialized],
          }),
        });
        const json = await res.json();
        if (json.error) throw new Error(JSON.stringify(json.error));
        return json.result as string;
      })
    );

    for (const r of results) if (r.status === 'fulfilled') return r.value;
    throw new Error('All Jito relays failed for bracket bundle');
  }

  private async confirmBundle(bundleId: string, timeoutMs = 30000): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const ep of this.jitoWallet.config.jitoEndpoints) {
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
            throw new Error(`Bundle on-chain failure: ${JSON.stringify(status.err)}`);
          }
        } catch {}
      }
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('Bracket bundle confirmation timeout');
  }

  async evaluateAndExecute(
    pos: BracketPosition,
    currentPriceSol: number,
    jitoTipSol: number
  ): Promise<AtomicBundleResult | null> {
    const trigger = this.checkTrigger(pos, currentPriceSol);
    if (trigger === 'stale') {
      await this.prebuildBracketOrders(pos);
      return null;
    }
    if (trigger === 'tp' || trigger === 'sl') {
      return this.executeAtomicExit(pos, trigger, jitoTipSol);
    }
    return null;
  }
}
