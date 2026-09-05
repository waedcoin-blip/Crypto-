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

  public resolveNetwork(network?: string): NetworkType {
    if (!network) {
      throw new Error("INVALID_NETWORK_EXPLICIT_REQUIRED: Network parameter is required and cannot be empty.");
    }
    const net = network.toLowerCase().trim();
    if (net === 'mainnet' || net === 'mainnet-beta') return 'mainnet';
    if (net === 'devnet') return 'devnet';
    if (net === 'paper') return 'paper';

    throw new Error(`INVALID_NETWORK_EXPLICIT_REQUIRED: '${network}' is not a valid network. Expected 'paper', 'devnet', or 'mainnet'.`);
  }

  public getExecutor(network: string): TradeExecutor {
    const net = this.resolveNetwork(network);
    if (net === 'mainnet') return this.mainnetExecutor;
    if (net === 'devnet') return this.devnetExecutor;
    if (net === 'paper') return this.paperExecutor;

    throw new Error(`INVALID_NETWORK_EXPLICIT_REQUIRED: '${network}' is not supported.`);
  }

  public async verifyReadiness(network: string, walletAddress?: string): Promise<{ ready: boolean; reason?: string }> {
    try {
      const net = this.resolveNetwork(network);
      if (net === 'paper') {
        const sol = paperWalletLedger.getSolBalance();
        if (typeof sol === 'number' && sol >= 0) {
          return { ready: true };
        }
        return { ready: false, reason: 'PaperWalletLedger return invalid balance' };
      }

      const exec = this.getExecutor(net);
      const balance = await exec.getBalance(walletAddress);
      if (typeof balance === 'number' && !isNaN(balance)) {
        return { ready: true };
      }
      return { ready: false, reason: `Executor for ${net} returned invalid balance` };
    } catch (err: any) {
      return { ready: false, reason: err?.message || String(err) };
    }
  }

  async quoteBuy(params: QuoteParams): Promise<QuoteResult> {
    const net = this.resolveNetwork(params.network);
    return this.getExecutor(net).quoteBuy({ ...params, network: net });
  }

  async quoteSell(params: QuoteParams): Promise<QuoteResult> {
    const net = this.resolveNetwork(params.network);
    return this.getExecutor(net).quoteSell({ ...params, network: net });
  }

  async buy(params: ExecuteParams): Promise<ExecutionResult> {
    const net = this.resolveNetwork(params.network);
    return this.getExecutor(net).buy({ ...params, network: net });
  }

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    const net = this.resolveNetwork(params.network);
    return this.getExecutor(net).sell({ ...params, network: net });
  }

  async getBalance(walletAddress?: string, network?: string): Promise<number> {
    const net = this.resolveNetwork(network);
    return this.getExecutor(net).getBalance(walletAddress);
  }

  async getTokenBalance(mint: string, walletAddress?: string, network?: string): Promise<number> {
    const net = this.resolveNetwork(network);
    return this.getExecutor(net).getTokenBalance(mint, walletAddress);
  }
}

export const executionGateway = ExecutionGateway.getInstance();

