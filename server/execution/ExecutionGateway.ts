// server/execution/ExecutionGateway.ts
import { TradeExecutor, QuoteParams, QuoteResult, ExecuteParams, ExecutionResult } from './TradeExecutor.js';
import { PaperTradeExecutor } from './PaperTradeExecutor.js';
import { DevnetTradeExecutor } from './DevnetTradeExecutor.js';
import { MainnetTradeExecutor } from './MainnetTradeExecutor.js';
import { paperWalletLedger } from '../wallet/PaperWalletLedger.js';

export type NetworkType = 'paper' | 'devnet' | 'mainnet';

export class ExecutionGateway implements TradeExecutor {
  private static instance: ExecutionGateway;
  private paperExecutor: PaperTradeExecutor;
  private devnetExecutor: DevnetTradeExecutor;
  private mainnetExecutor: MainnetTradeExecutor;

  public readonly network: string = 'gateway';

  private constructor() {
    this.paperExecutor = new PaperTradeExecutor();
    this.devnetExecutor = new DevnetTradeExecutor();
    this.mainnetExecutor = new MainnetTradeExecutor();
  }

  public static getInstance(): ExecutionGateway {
    if (!ExecutionGateway.instance) {
      ExecutionGateway.instance = new ExecutionGateway();
    }
    return ExecutionGateway.instance;
  }

  // ==========================================
  // NETWORK RESOLUTION
  // ==========================================

  public resolveNetwork(network?: string, scopedPrefix?: string): NetworkType {
    // 1. Check scoped prefix (e.g., "mainnet:wallet1")
    if (scopedPrefix && scopedPrefix.includes(':')) {
      const prefix = scopedPrefix.split(':')[0].toLowerCase().trim();
      if (['paper', 'devnet', 'mainnet'].includes(prefix)) {
        return prefix as NetworkType;
      }
    }

    // 2. Check explicit network parameter
    if (network) {
      const normalized = network.toLowerCase().trim();
      if (normalized === 'mainnet-beta') return 'mainnet';
      if (['paper', 'devnet', 'mainnet'].includes(normalized)) {
        return normalized as NetworkType;
      }
    }

    // 3. Default to paper (fail-safe)
    return 'paper';
  }

  // ==========================================
  // EXECUTOR ROUTING
  // ==========================================

  public getExecutor(network: string): TradeExecutor {
    const resolved = this.resolveNetwork(network);
    switch (resolved) {
      case 'mainnet':
        return this.mainnetExecutor;
      case 'devnet':
        return this.devnetExecutor;
      case 'paper':
      default:
        return this.paperExecutor;
    }
  }

  // ==========================================
  // READINESS VERIFICATION
  // ==========================================

  public async verifyReadiness(network?: string, walletAddress?: string): Promise<{ ready: boolean; reason?: string }> {
    const executor = this.getExecutor(network || 'paper');
    try {
      return await executor.verifyReadiness();
    } catch (err: any) {
      return { ready: false, reason: `READINESS_CHECK_FAILED: ${err?.message || String(err)}` };
    }
  }

  // ==========================================
  // TradeExecutor INTERFACE IMPLEMENTATION
  // ==========================================

  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    const executor = this.getExecutor(params.network || 'paper');
    return executor.getQuote(params);
  }

  async buy(params: ExecuteParams): Promise<ExecutionResult> {
    const executor = this.getExecutor(params.network);
    return executor.buy(params);
  }

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    const executor = this.getExecutor(params.network);
    return executor.sell(params);
  }

  async getSolBalance(walletAddress?: string): Promise<number> {
    return this.paperExecutor.getSolBalance(walletAddress);
  }

  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {
    return this.paperExecutor.getTokenBalance(mint, walletAddress);
  }

  async verifyReadinessForNetwork(network: string): Promise<{ ready: boolean; reason?: string }> {
    return this.verifyReadiness(network);
  }
}

export const executionGateway = ExecutionGateway.getInstance();
