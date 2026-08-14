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

        expectedSolReceived += Number(quote.outAmount) / 1e9;

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
      } catch (err: any) {
        console.error(`Failed to build swap for ${pos.mint}:`, err.message);
        failedMints.push(pos.mint);
      }
    }

    if (allInstructions.length <= 2) throw new Error('No viable swaps in batch');

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

    if (sim.value.err) throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);

    const signature = await this.connection.sendTransaction(transaction, {
      skipPreflight: true,
      maxRetries: 2,
      preflightCommitment: 'confirmed',
    });

    const slot = await this.confirm(signature);
    const landingTimeMs = Date.now() - startTime;
    const baseFee = 0.000005;
    const priorityFeeSol = (this.config.priorityFeeMicroLamports * 1_400_000) / 1e15;
    const totalFeesSol = baseFee + priorityFeeSol;
    const rentReclaimedSol = atasToClose.length * 0.002039;

    return {
      signature,
      slot,
      positionsExited: positions.length - failedMints.length,
      totalFeesSol,
      rentReclaimedSol,
      netSolReceived: expectedSolReceived,
      failedMints,
      landingTimeMs,
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
