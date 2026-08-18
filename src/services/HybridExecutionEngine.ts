import { getKeypairFromPrivateKey } from '../utils/keypairUtils';
// src/services/HybridExecutionEngine.ts
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

export interface HybridConfig {
  rpcEndpoint: string;
  jupiterEndpoint: string;
  jupiterApiKey: string;
  privateKeyBase58: string;
  jitoEndpoints: string[];
  heliusRpcUrl: string;
  defaultJitoTipSol: number;
  minJitoTipSol: number;
  maxJitoTipSol: number;
  heliusMinTipSol: number;
  vaultPubkey: string;
  profitSharePct: number;
  verbose?: boolean;
}

export interface PositionSnapshot {
  mint: string;
  amount: number;
  solSpent: number;
  tpPct: number;
  slPct: number;
}

export interface AtomicBundleResult {
  method: 'jito' | 'helius';
  signature: string;
  side: 'tp' | 'sl';
  slot: number;
  netSolToWallet: number;
  profitShared: number;
  tipSol: number;
  landingTimeMs: number;
  simulated: boolean;
  simulationUnitsConsumed?: number;
}

export class HybridExecutionEngine {
  public connection: Connection;
  public wallet: Keypair;
  public publicKey: PublicKey;
  public jupiterApi: ReturnType<typeof createJupiterApiClient>;
  private config: HybridConfig;
  private consecutiveJitoFailures = 0;
  private readonly JITO_FAILURE_THRESHOLD = 3;
  private readonly JITO_TIP_ACCOUNTS = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMYXKw7QoxYKD2h9p',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'DfXygSm4jCyRCybV98g3K7ErfS82pfBahsVTaDzkoKAW',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  ].map(a => new PublicKey(a));

  constructor(config: HybridConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    this.wallet = getKeypairFromPrivateKey(config.privateKeyBase58);
    this.publicKey = this.wallet.publicKey;
    this.jupiterApi = createJupiterApiClient({ basePath: config.jupiterEndpoint });
  }

  private log(...args: any[]) {
    if (this.config.verbose) console.log('[HybridEngine]', ...args);
  }

  private async getExitQuote(pos: PositionSnapshot, side: 'tp' | 'sl') {
    const WSOL = 'So11111111111111111111111111111111111111112';
    return this.jupiterApi.quoteGet({
      inputMint: pos.mint,
      outputMint: WSOL,
      amount: pos.amount,
      slippageBps: side === 'tp' ? 200 : 1000,
      restrictIntermediateTokens: true,
    });
  }

  private async resolveALTs(tx: VersionedTransaction): Promise<AddressLookupTableAccount[]> {
    if (tx.message.addressTableLookups.length === 0) return [];
    const results = await Promise.all(
      tx.message.addressTableLookups.map(l =>
        this.connection.getAddressLookupTable(l.accountKey)
      )
    );
    return results.map(r => r.value).filter(Boolean) as AddressLookupTableAccount[];
  }

  async buildAtomicBundle(
    pos: PositionSnapshot,
    side: 'tp' | 'sl',
    quote: any,
    jitoTipSol: number
  ): Promise<VersionedTransaction[]> {
    const lbh = await this.connection.getLatestBlockhash();

    // Tx 1: Jupiter Exit Swap
    const swapBuild = await this.jupiterApi.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey: this.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { jitoTipLamports: 0 } as any,
      },
    });

    const swapTx = VersionedTransaction.deserialize(
      Buffer.from(swapBuild.swapTransaction, 'base64')
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
    const minOutLamports = Number(quote.otherAmountThreshold);
    const solSpentLamports = Math.floor(pos.solSpent * LAMPORTS_PER_SOL);
    const grossProfit = Math.max(0, minOutLamports - solSpentLamports);
    const feeShare = Math.floor(grossProfit * (this.config.profitSharePct / 100));

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
              toPubkey: new PublicKey(this.config.vaultPubkey),
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
    const tipAccount = this.JITO_TIP_ACCOUNTS[Math.floor(Math.random() * this.JITO_TIP_ACCOUNTS.length)];
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

    return bundle;
  }

  // simulateBundle pre-flight
  async simulateBundle(txs: VersionedTransaction[]) {
    const serialized = txs.map(tx => Buffer.from(tx.serialize()).toString('base64'));

    for (const endpoint of this.config.jitoEndpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'simulateBundle',
            params: [serialized],
          }),
        });
        const json = await res.json();
        if (json.error) {
          this.log('Sim RPC error:', json.error);
          continue;
        }
        const simulations = json.result?.value || [];
        const failures = simulations
          .map((s: any, i: number) => (s.err ? `Tx[${i}]: ${JSON.stringify(s.err)}` : null))
          .filter(Boolean);

        if (failures.length > 0) throw new Error(`Simulation revert: ${failures.join('; ')}`);

        return {
          allPassed: true,
          results: simulations.map((s: any) => ({
            err: s.err,
            logs: s.logs || [],
            unitsConsumed: s.unitsConsumed || 0,
          })),
        };
      } catch (e: any) {
        this.log('Sim attempt failed:', e.message);
      }
    }
    throw new Error('All Jito relays failed simulation');
  }

  // Jito submission
  async submitJitoBundle(txs: VersionedTransaction[]): Promise<string> {
    const serialized = txs.map(tx => Buffer.from(tx.serialize()).toString('base64'));
    const results = await Promise.allSettled(
      this.config.jitoEndpoints.map(async endpoint => {
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
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason.message);
    throw new Error(`Jito relays failed: ${errors.join(' | ')}`);
  }

  async confirmJitoBundle(bundleId: string, timeoutMs = 30000): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const endpoint of this.config.jitoEndpoints) {
        try {
          const res = await fetch(endpoint, {
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
    throw new Error('Jito confirmation timeout');
  }

  // Helius Sender Max fallback
  async submitHeliusFallback(pos: PositionSnapshot, side: 'tp' | 'sl', quote: any) {
    this.log('Jito congested — activating Helius Sender Max fallback');
    const swapBuild = await this.jupiterApi.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey: this.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: Math.floor(this.config.heliusMinTipSol * LAMPORTS_PER_SOL),
            priorityLevel: 'very_high',
          },
        } as any,
      },
    });

    const tx = VersionedTransaction.deserialize(Buffer.from(swapBuild.swapTransaction, 'base64'));
    const alts = await this.resolveALTs(tx);
    const lbh = await this.connection.getLatestBlockhash();
    const msg = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: alts });
    msg.payerKey = this.publicKey;
    msg.recentBlockhash = lbh.blockhash;

    const compiled = msg.compileToV0Message(alts);
    const signed = new VersionedTransaction(compiled);
    signed.sign([this.wallet]);

    const serialized = Buffer.from(signed.serialize()).toString('base64');
    const res = await fetch(this.config.heliusRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [
          serialized,
          {
            encoding: 'base64',
            skipPreflight: true,
            maxRetries: 3,
            minContextSlot: await this.connection.getSlot(),
          },
        ],
      }),
    });

    const json = await res.json();
    if (json.error) throw new Error(`Helius fallback failed: ${JSON.stringify(json.error)}`);
    const signature = json.result as string;
    const slot = await this.confirmHelius(signature);
    return { signature, slot };
  }

  private async confirmHelius(signature: string, timeoutMs = 20000): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.connection.getSignatureStatus(signature);
      if (
        status?.value?.confirmationStatus === 'confirmed' ||
        status?.value?.confirmationStatus === 'finalized'
      ) {
        if (!status.value.err) return status.value.slot || 0;
        throw new Error(`Helius tx failed: ${JSON.stringify(status.value.err)}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Helius confirmation timeout');
  }

  // Full flow: quote -> build -> simulate -> jito -> helius fallback
  async executeAtomicExit(
    pos: PositionSnapshot,
    side: 'tp' | 'sl',
    jitoTipSol: number
  ): Promise<AtomicBundleResult> {
    const startTime = Date.now();
    const quote = await this.getExitQuote(pos, side);
    const bundle = await this.buildAtomicBundle(pos, side, quote, jitoTipSol);

    let simulationUnits = 0;
    try {
      const sim = await this.simulateBundle(bundle);
      simulationUnits = sim.results.reduce((sum: number, r: any) => sum + r.unitsConsumed, 0);
      this.log(`Simulation OK, ${simulationUnits} CU`);
    } catch (e: any) {
      this.log('SIMULATION ABORT — tip saved:', e.message);
      throw new Error(`SimAbort: ${e.message}`);
    }

    let method: 'jito' | 'helius' = 'jito';
    let signature: string, slot: number;

    try {
      const bundleId = await this.submitJitoBundle(bundle);
      slot = await this.confirmJitoBundle(bundleId);
      signature = bundleId;
      this.consecutiveJitoFailures = 0;
    } catch (jitoErr: any) {
      this.consecutiveJitoFailures++;
      this.log(`Jito fail #${this.consecutiveJitoFailures}:`, jitoErr.message);
      if (this.consecutiveJitoFailures >= this.JITO_FAILURE_THRESHOLD) {
        const helius = await this.submitHeliusFallback(pos, side, quote);
        slot = helius.slot;
        signature = helius.signature;
        method = 'helius';
      } else {
        throw jitoErr;
      }
    }

    const minOutLamports = Number(quote.otherAmountThreshold);
    const solSpentLamports = Math.floor(pos.solSpent * LAMPORTS_PER_SOL);
    const grossProfit = Math.max(0, minOutLamports - solSpentLamports);
    const feeShare = Math.floor(grossProfit * (this.config.profitSharePct / 100));

    return {
      method,
      signature,
      side,
      slot,
      netSolToWallet: (minOutLamports - feeShare) / LAMPORTS_PER_SOL,
      profitShared: feeShare / LAMPORTS_PER_SOL,
      tipSol: method === 'jito' ? jitoTipSol : this.config.heliusMinTipSol,
      landingTimeMs: Date.now() - startTime,
      simulated: true,
      simulationUnitsConsumed: simulationUnits,
    };
  }

  // Bracket evaluation (TP / SL / Trailing SL)
  async evaluateBracket(
    pos: PositionSnapshot,
    currentPriceSol: number,
    peakPnLPct: number
  ): Promise<AtomicBundleResult | null> {
    const tpPrice = (pos.solSpent * (1 + pos.tpPct / 100)) / pos.amount;
    const slPrice = (pos.solSpent * (1 - pos.slPct / 100)) / pos.amount;
    const trailingSL =
      peakPnLPct > 20
        ? (pos.solSpent * (1 + (peakPnLPct - 15) / 100)) / pos.amount
        : slPrice;
    const effectiveSL = Math.max(slPrice, trailingSL);

    let side: 'tp' | 'sl' | null = null;
    if (currentPriceSol >= tpPrice) side = 'tp';
    else if (currentPriceSol <= effectiveSL) side = 'sl';

    if (!side) return null;

    const tip = this.getRecommendedTip();
    return this.executeAtomicExit(pos, side, tip);
  }

  isJitoCongested(): boolean {
    return this.consecutiveJitoFailures >= this.JITO_FAILURE_THRESHOLD;
  }

  calibrateJitoTip(lastTipSol: number, landed: boolean): number {
    let newTip = lastTipSol;
    if (!landed) newTip = Math.min(lastTipSol * 1.25, this.config.maxJitoTipSol);
    else if (this.consecutiveJitoFailures === 0) {
      newTip = Math.max(lastTipSol * 0.95, this.config.minJitoTipSol);
    }
    this.log(`Tip: ${lastTipSol.toFixed(6)} -> ${newTip.toFixed(6)} SOL`);
    return newTip;
  }

  getRecommendedTip(): number {
    if (this.isJitoCongested()) {
      return Math.min(this.config.defaultJitoTipSol * 1.5, this.config.maxJitoTipSol);
    }
    return this.config.defaultJitoTipSol;
  }
}
