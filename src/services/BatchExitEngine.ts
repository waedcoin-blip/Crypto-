// src/services/BatchExitEngine.ts
import {
  Connection,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  PublicKey,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import { createJupiterApiClient } from '@jup-ag/api';
import bs58 from 'bs58';

export interface MicroPosition {
  mint: string;
  amount: number;
  solSpent: number;
}

export interface BatchExitConfig {
  rpcEndpoint: string;
  jupiterEndpoint: string;
  jupiterApiKey: string;
  privateKeyBase58: string;
  priorityFeeMicroLamports: number;
  slippageBps: number;
  closeAtas: boolean;
  maxBatchSize?: number;
}

export interface BatchExitResult {
  signature: string;
  slot: number;
  positionsExited: number;
  totalFeesSol: number;
  rentReclaimedSol: number;
  netSolReceived: number;
  failedMints: string[];
  landingTimeMs: number;
  perPositionResults: {
    mint: string;
    success: boolean;
    amountReceivedSol?: number;
  }[];
}

export class BatchExitEngine {
  private connection: Connection;
  private wallet: Keypair;
  private jupiterApi: ReturnType<typeof createJupiterApiClient>;
  private config: Required<BatchExitConfig>;

  constructor(config: BatchExitConfig) {
    this.config = { maxBatchSize: 6, ...config };
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    this.wallet = Keypair.fromSecretKey(bs58.decode(config.privateKeyBase58));
    this.jupiterApi = createJupiterApiClient({ basePath: config.jupiterEndpoint });
  }

  async batchExit(positions: MicroPosition[]): Promise<BatchExitResult[]> {
    const chunks = this.chunk(positions, this.config.maxBatchSize);
    const results: BatchExitResult[] = [];
    for (const chunk of chunks) {
      results.push(await this.executeBatch(chunk));
    }
    return results;
  }

  private async executeBatch(positions: MicroPosition[]): Promise<BatchExitResult> {
    const startTime = Date.now();
    const WSOL_MINT = 'So11111111111111111111111111111111111111112';
    const failedMints: string[] = [];
    const allInstructions: any[] = [];
    const allAlts: Set<string> = new Set();
    const perPositionResults: BatchExitResult['perPositionResults'] = [];

    // Compute budget (once for entire batch)
    allInstructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: this.config.priorityFeeMicroLamports,
      })
    );

    const atasToClose: { ata: PublicKey; mint: string }[] = [];

    let expectedSolReceived = 0;

    for (const pos of positions) {
      try {
        const quote = await this.jupiterApi.quoteGet({
          inputMint: pos.mint,
          outputMint: WSOL_MINT,
          amount: pos.amount,
          slippageBps: this.config.slippageBps,
          restrictIntermediateTokens: true,
        });

        const swapInstructions = await this.jupiterApi.swapInstructionsPost({
          swapRequest: {
            quoteResponse: quote,
            userPublicKey: this.wallet.publicKey.toBase58(),
          },
        });

        const expectedOut = Number(quote.outAmount) / 1e9;
        expectedSolReceived += expectedOut;

        const ixs = this.decodeInstructions(swapInstructions);
        allInstructions.push(...ixs);
        swapInstructions.addressLookupTableAddresses?.forEach((a: string) => allAlts.add(a));

        if (this.config.closeAtas) {
          const inputATA = getAssociatedTokenAddressSync(
            new PublicKey(pos.mint),
            this.wallet.publicKey
          );
          atasToClose.push({ ata: inputATA, mint: pos.mint });
        }
        
        perPositionResults.push({
          mint: pos.mint,
          success: true, // Optimistically true, updated on failure
          amountReceivedSol: expectedOut, // Estimated for now
        });
      } catch (err: any) {
        console.error(`Failed to build swap for ${pos.mint}:`, err.message);
        failedMints.push(pos.mint);
        perPositionResults.push({
          mint: pos.mint,
          success: false,
          amountReceivedSol: 0,
        });
      }
    }

    if (allInstructions.length <= 2) {
       // All failed to build
       return {
          signature: '',
          slot: 0,
          positionsExited: 0,
          totalFeesSol: 0,
          rentReclaimedSol: 0,
          netSolReceived: 0,
          failedMints: positions.map(p => p.mint),
          landingTimeMs: Date.now() - startTime,
          perPositionResults: positions.map(p => ({ mint: p.mint, success: false, amountReceivedSol: 0 }))
       };
    }

    for (const { ata } of atasToClose) {
      allInstructions.push(
        createCloseAccountInstruction(ata, this.wallet.publicKey, this.wallet.publicKey)
      );
    }

    const wSOLATA = getAssociatedTokenAddressSync(
      new PublicKey(WSOL_MINT),
      this.wallet.publicKey
    );
    allInstructions.unshift(
      createAssociatedTokenAccountIdempotentInstruction(
        this.wallet.publicKey,
        wSOLATA,
        this.wallet.publicKey,
        new PublicKey(WSOL_MINT)
      )
    );

    const lbh = await this.connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: this.wallet.publicKey,
      recentBlockhash: lbh.blockhash,
      instructions: allInstructions,
    });

    const altAccounts = await Promise.all(
      Array.from(allAlts).map(addr =>
        this.connection.getAddressLookupTable(new PublicKey(addr))
      )
    );

    const validAlts = altAccounts
      .map(r => r.value)
      .filter((alt): alt is AddressLookupTableAccount => alt !== null);

    const compiledMessage = message.compileToV0Message(validAlts);
    const transaction = new VersionedTransaction(compiledMessage);
    transaction.sign([this.wallet]);

    // Simulate before sending
    const sim = await this.connection.simulateTransaction(transaction, {
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
    });

    if (sim.value.err) {
      const errStr = JSON.stringify(sim.value.err);
      perPositionResults.forEach(p => p.success = false);
      throw new Error(`Simulation failed: ${errStr}`);
    }

    // Bug 18: use preflight simulation, not skipPreflight
    const signature = await this.connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 2,
      preflightCommitment: 'confirmed',
    });

    const slot = await this.confirm(signature);
    
    // Bug 17: Fetch actual fee from confirmed transaction metadata
    let actualFeeSol = (this.config.priorityFeeMicroLamports * 1_400_000) / 1e15 + 0.000005; // Fallback estimate
    let actualSolReceived = expectedSolReceived; // Fallback estimate

    try {
      const txDetails = await this.connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (txDetails?.meta) {
        if (txDetails.meta.fee !== undefined) {
          actualFeeSol = txDetails.meta.fee / 1e9;
        }
        
        // Bug 5: Compute actual netSolReceived from pre/post balances
        const accountIndex = txDetails.transaction.message.staticAccountKeys.findIndex(k => k.equals(this.wallet.publicKey));
        if (accountIndex >= 0) {
          const preBalance = txDetails.meta.preBalances[accountIndex];
          const postBalance = txDetails.meta.postBalances[accountIndex];
          
          // Net change in SOL balance + fee paid gives the total SOL received from swaps
          actualSolReceived = (postBalance - preBalance + (txDetails.meta.fee || 0)) / 1e9;
          
          // It's a batch swap, so we roughly distribute the actual received SOL to positions proportional to expected
          if (expectedSolReceived > 0 && actualSolReceived > 0) {
            const ratio = actualSolReceived / expectedSolReceived;
            perPositionResults.forEach(p => {
              if (p.success && p.amountReceivedSol) {
                p.amountReceivedSol *= ratio;
              }
            });
          }
        }
      }
    } catch (e) {
      // Ignore metadata fetch error, fallback to estimate
    }
    
    const landingTimeMs = Date.now() - startTime;
    const rentReclaimedSol = atasToClose.length * 0.002039;

    return {
      signature,
      slot,
      positionsExited: positions.length - failedMints.length,
      totalFeesSol: actualFeeSol,
      rentReclaimedSol,
      netSolReceived: actualSolReceived,
      failedMints,
      landingTimeMs,
      perPositionResults,
    };
  }

  private decodeInstructions(swapIxResponse: any): any[] {
    const ixs: any[] = [];
    if (swapIxResponse.tokenLedgerInstruction) {
      ixs.push(this.ixFromJson(swapIxResponse.tokenLedgerInstruction));
    }
    for (const ix of swapIxResponse.setupInstructions || []) {
      ixs.push(this.ixFromJson(ix));
    }
    if (swapIxResponse.swapInstruction) {
      ixs.push(this.ixFromJson(swapIxResponse.swapInstruction));
    }
    if (swapIxResponse.cleanupInstruction) {
      ixs.push(this.ixFromJson(swapIxResponse.cleanupInstruction));
    }
    return ixs;
  }

  private ixFromJson(ix: any): any {
    return {
      keys: ix.accounts.map((a: any) => ({
        pubkey: new PublicKey(a.pubkey),
        isSigner: a.isSigner,
        isWritable: a.isWritable,
      })),
      programId: new PublicKey(ix.programId),
      data: Buffer.from(ix.data, 'base64'),
    };
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  private async confirm(signature: string, timeoutMs = 30000): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.connection.getSignatureStatus(signature);
      if (
        status?.value?.confirmationStatus === 'confirmed' ||
        status?.value?.confirmationStatus === 'finalized'
      ) {
        if (!status.value.err) return status.value.slot || 0;
        throw new Error(`Tx failed: ${JSON.stringify(status.value.err)}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Confirmation timeout');
  }
}
