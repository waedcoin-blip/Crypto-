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
    const net = network.toLowerCase();
    if (net === 'paper') return this.paperExecutor;
    if (net === 'devnet') return this.devnetExecutor;
    return this.mainnetExecutor;
  }

  async quoteBuy(params: QuoteParams): Promise<QuoteResult> {
    const net = params.network || 'paper';
    return this.getExecutor(net).quoteBuy(params);
  }

  async quoteSell(params: QuoteParams): Promise<QuoteResult> {
    const net = params.network || 'paper';
    return this.getExecutor(net).quoteSell(params);
  }

  async buy(params: ExecuteParams): Promise<ExecutionResult> {
    const net = params.walletAddress?.startsWith('devnet') ? 'devnet' : params.walletAddress?.startsWith('mainnet') ? 'mainnet' : 'paper';
    return this.getExecutor(net).buy(params);
  }

  async sell(params: ExecuteParams): Promise<ExecutionResult> {
    const net = params.walletAddress?.startsWith('devnet') ? 'devnet' : params.walletAddress?.startsWith('mainnet') ? 'mainnet' : 'paper';
    return this.getExecutor(net).sell(params);
  }

  async getBalance(walletAddress?: string): Promise<number> {
    const net = walletAddress?.startsWith('devnet') ? 'devnet' : walletAddress?.startsWith('mainnet') ? 'mainnet' : 'paper';
    return this.getExecutor(net).getBalance(walletAddress);
  }

  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {
    const net = walletAddress?.startsWith('devnet') ? 'devnet' : walletAddress?.startsWith('mainnet') ? 'mainnet' : 'paper';
    return this.getExecutor(net).getTokenBalance(mint, walletAddress);
  }
}

export const executionGateway = ExecutionGateway.getInstance();
