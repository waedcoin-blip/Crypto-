// server/execution/MainnetTradeExecutor.ts
import {
  TradeExecutor,
  QuoteParams,
  QuoteResult,
  ExecuteParams,
  ExecutionResult,
  ExecutionError,
  classifyExecutionError,
} from './TradeExecutor.js';
import { config, getJupiterApiKey } from '../config/index.js';
import { fetchWithRetry } from '../utils/fetch.js';
import { logger } from '../utils/logger.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export class MainnetTradeExecutor implements TradeExecutor {
  public readonly network: string = 'mainnet';

  private telemetryTotalSwaps: number = 0;
  private telemetryFailedSwaps: number = 0;
  private telemetryTotalFeesPaidSol: number = 0;
  private telemetryLandingTimeTotalMs: number = 0;
  private lastFailureReason: string = '';

  // ==========================================
  // QUOTE
  // ==========================================

  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    try {
      const jupBaseUrl = 'https://api.jup.ag/swap/v1';
      const apiKey = getJupiterApiKey();
      const queryParams = new URLSearchParams({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: String(params.amount),
        slippageBps: String(params.slippageBps),
        swapMode: 'ExactIn',
      });

      const url = `${jupBaseUrl}/quote?${queryParams.toString()}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;

      const { response, text } = await fetchWithRetry(url, { method: 'GET', headers, timeoutMs: 8000 }, 2, 500);

      if (!response.ok) {
        return { success: false, error: `JUPITER_QUOTE_HTTP_${response.status}` };
      }

      const quote = JSON.parse(text);
      if (!quote || !quote.routePlan || quote.routePlan.length === 0) {
        return { success: false, error: 'NO_ROUTE_FOUND' };
      }

      return {
        success: true,
        quote,
        outAmountLamports: Number(quote.outAmount) || 0,
        outAmountRaw: String(quote.outAmount),
        priceImpactPct: Number(quote.priceImpactPct) || 0,
        routePlanLength: quote.routePlan.length,
      };
    } catch (err: any) {
      return { success: false, error: `QUOTE_EXCEPTION: ${err?.message || String(err)}` };
    }
  }

  // ==========================================
  // BUY (SOL → Token)
  // ==========================================

  async buy(params: ExecuteParams): Promise<ExecutionResult> {
    return this.executeSwap({ ...params, isBuy: true });
  }

  // ==========================================
  // SELL (Token → SOL)
  // ==========================================

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    return this.executeSwap({ ...params, isBuy: false });
  }

  // ==========================================
  // CORE SWAP EXECUTION
  // ==========================================

  private async executeSwap(params: ExecuteParams & { isBuy: boolean }): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // 1. Get or validate quote
      let quote = params.preValidatedQuote;
      if (!quote) {
        const quoteResult = await this.getQuote({
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: params.slippageBps,
          network: params.network,
          walletAddress: params.walletAddress,
        });
        if (!quoteResult.success || !quoteResult.quote) {
          throw new ExecutionError('NO_ROUTE_FOUND', `Quote failed: ${quoteResult.error}`);
        }
        quote = quoteResult.quote;
      }

      // 2. Get swap transaction from Jupiter
      const jupBaseUrl = 'https://api.jup.ag/swap/v1';
      const apiKey = getJupiterApiKey();
      const swapUrl = `${jupBaseUrl}/swap`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;

      const swapPayload = {
        quoteResponse: quote,
        userPublicKey: params.walletAddress,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      };

      const swapResponse = await fetchWithRetry(swapUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(swapPayload),
        timeoutMs: 15000,
      }, 2, 1000);

      if (!swapResponse.response.ok) {
        throw new ExecutionError('RPC_ERROR', `Jupiter swap HTTP ${swapResponse.response.status}`);
      }

      const swapData = JSON.parse(swapResponse.text);
      if (!swapData.swapTransaction) {
        throw new ExecutionError('RPC_ERROR', 'Jupiter returned no swapTransaction');
      }

      // 3. Sign and broadcast (delegated to WalletManager via ExecutionGateway)
      // In production, this would use the server-side keypair to sign
      const { walletManager } = await import('../wallet/WalletManager.js');
      const signature = await walletManager.signAndBroadcast(
        swapData.swapTransaction,
        params.walletAddress,
        params.network
      );

      if (!signature) {
        throw new ExecutionError('SIGNATURE_ERROR', 'Transaction signing or broadcast failed');
      }

      // 4. Notify broadcast
      if (params.onBroadcast) {
        await params.onBroadcast(signature);
      }

      // 5. Confirm transaction
      const confirmed = await this.confirmTransaction(signature, params.network);
      if (!confirmed) {
        return {
          success: false,
          signature,
          error: 'CONFIRMATION_TIMEOUT',
          isBroadcasted: true,
          isAmbiguous: true,
          durationMs: Date.now() - startTime,
        };
      }

      const durationMs = Date.now() - startTime;
      this.telemetryTotalSwaps++;
      this.telemetryLandingTimeTotalMs += durationMs;

      return {
        success: true,
        signature,
        outAmountRaw: String(quote.outAmount),
        outAmountLamports: Number(quote.outAmount),
        durationMs,
      };
    } catch (err: any) {
      const classification = classifyExecutionError(err);
      this.telemetryFailedSwaps++;
      this.lastFailureReason = `[${classification}] ${err.message || String(err)}`;
      logger.error({ classification, error: this.lastFailureReason, mint: params.inputMint }, 'MainnetTradeExecutor swap failed');

      return {
        success: false,
        error: this.lastFailureReason,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ==========================================
  // TRANSACTION CONFIRMATION
  // ==========================================

  private async confirmTransaction(signature: string, network: string, timeoutMs: number = 30000): Promise<boolean> {
    try {
      const rpcUrl = config.EXECUTION_RPC_URL || 'https://api.mainnet-beta.solana.com';

      const { Connection } = await import('@solana/web3.js');
      const connection = new Connection(rpcUrl, 'confirmed');

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
        if (status?.value) {
          if (status.value.err) {
            return false; // Transaction failed on-chain
          }
          if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
            return true;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return false;
    } catch {
      return false;
    }
  }

  // ==========================================
  // BALANCE QUERIES
  // ==========================================

  async getSolBalance(walletAddress?: string): Promise<number> {
    try {
      const rpcUrl = config.EXECUTION_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      const connection = new Connection(rpcUrl, 'confirmed');
      const pubkey = new PublicKey(walletAddress || '');
      const balance = await connection.getBalance(pubkey, 'confirmed');
      return balance / LAMPORTS_PER_SOL;
    } catch {
      return 0;
    }
  }

  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {
    try {
      const rpcUrl = config.EXECUTION_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const { Connection, PublicKey } = await import('@solana/web3.js');
      const connection = new Connection(rpcUrl, 'confirmed');
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        new PublicKey(walletAddress || ''),
        { mint: new PublicKey(mint) }
      );
      if (tokenAccounts.value.length === 0) return 0;
      const info = tokenAccounts.value[0].account.data.parsed.info;
      return info.tokenAmount.uiAmount || 0;
    } catch {
      return 0;
    }
  }

  async verifyReadiness(): Promise<{ ready: boolean; reason?: string }> {
    try {
      const rpcUrl = config.EXECUTION_RPC_URL;
      if (!rpcUrl) {
        return { ready: false, reason: 'EXECUTION_RPC_URL not configured' };
      }
      const { response } = await fetchWithRetry(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        timeoutMs: 5000,
      }, 1, 0);
      if (response.ok) {
        return { ready: true };
      }
      return { ready: false, reason: `RPC health check returned ${response.status}` };
    } catch (err: any) {
      return { ready: false, reason: `READINESS_CHECK_FAILED: ${err?.message}` };
    }
  }

  // ==========================================
  // TELEMETRY
  // ==========================================

  public getTelemetry() {
    const totalAttempted = this.telemetryTotalSwaps + this.telemetryFailedSwaps;
    return {
      totalSwaps: this.telemetryTotalSwaps,
      totalFeesPaidSol: this.telemetryTotalFeesPaidSol,
      avgLandingTimeMs: this.telemetryTotalSwaps > 0 ? this.telemetryLandingTimeTotalMs / this.telemetryTotalSwaps : 0,
      failureRate: totalAttempted > 0 ? this.telemetryFailedSwaps / totalAttempted : 0,
      lastFailure: this.lastFailureReason,
    };
  }
}
