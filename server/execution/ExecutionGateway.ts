// server/execution/ExecutionGateway.ts
import { TradeExecutor, QuoteParams, QuoteResult, ExecuteParams, ExecutionResult } from './TradeExecutor.js';
import { PaperTradeExecutor } from './PaperTradeExecutor.js';
import { DevnetTradeExecutor } from './DevnetTradeExecutor.js';
import { MainnetTradeExecutor } from './MainnetTradeExecutor.js';

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

  public getExecutor(network: string = 'paper'): TradeExecutor {
    const net = (network || 'paper').toLowerCase().trim();
    if (net === 'mainnet' || net === 'mainnet-beta') return this.mainnetExecutor;
    if (net === 'devnet') return this.devnetExecutor;
    return this.paperExecutor;
  }

  public resolveNetwork(network?: string, walletAddress?: string): NetworkType {
    if (network) {
      const net = network.toLowerCase().trim();
      if (net === 'mainnet' || net === 'mainnet-beta') return 'mainnet';
      if (net === 'devnet') return 'devnet';
      if (net === 'paper') return 'paper';
    }
    if (walletAddress) {
      if (walletAddress.startsWith('mainnet:') || walletAddress === 'mainnet') return 'mainnet';
      if (walletAddress.startsWith('devnet:') || walletAddress === 'devnet') return 'devnet';
      if (walletAddress.startsWith('paper:') || walletAddress === 'paper') return 'paper';
    }
    return 'paper';
  }

  async quoteBuy(params: QuoteParams): Promise<QuoteResult> {
    const net = this.resolveNetwork(params.network);
    return this.getExecutor(net).quoteBuy(params);
  }

  async quoteSell(params: QuoteParams): Promise<QuoteResult> {
    const net = this.resolveNetwork(params.network);
    return this.getExecutor(net).quoteSell(params);
  }

  async buy(params: ExecuteParams): Promise<ExecutionResult> {
    const net = this.resolveNetwork(params.network, params.walletAddress);
    return this.getExecutor(net).buy({ ...params, network: net });
  }

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    const net = this.resolveNetwork(params.network, params.walletAddress);
    return this.getExecutor(net).sell({ ...params, network: net });
  }

  async getBalance(walletAddress?: string, network?: string): Promise<number> {
    const net = this.resolveNetwork(network, walletAddress);
    return this.getExecutor(net).getBalance(walletAddress);
  }

  async getTokenBalance(mint: string, walletAddress?: string, network?: string): Promise<number> {
    const net = this.resolveNetwork(network, walletAddress);
    return this.getExecutor(net).getTokenBalance(mint, walletAddress);
  }
}

export const executionGateway = ExecutionGateway.getInstance();
