// server/execution/ExecutionGateway.ts
import { TradeExecutor, QuoteParams, ExecuteParams, QuoteResult, ExecutionResult } from './TradeExecutor.js';
import { PaperTradeExecutor } from './PaperTradeExecutor.js';
import { DevnetTradeExecutor } from './DevnetTradeExecutor.js';
import { MainnetTradeExecutor } from './MainnetTradeExecutor.js';

export type NetworkType = 'paper' | 'devnet' | 'mainnet';

export class ExecutionGateway implements TradeExecutor {
  private static instance: ExecutionGateway;
  private paperExecutor = new PaperTradeExecutor();
  private devnetExecutor = new DevnetTradeExecutor();
  private mainnetExecutor = new MainnetTradeExecutor();

  private constructor() {}
  public static getInstance(): ExecutionGateway {
    if (!ExecutionGateway.instance) ExecutionGateway.instance = new ExecutionGateway();
    return ExecutionGateway.instance;
  }

  public getExecutor(network: string = 'paper'): TradeExecutor {
    switch (network.trim().toLowerCase()) {
      case 'paper': return this.paperExecutor;
      case 'devnet': return this.devnetExecutor;
      case 'mainnet': return this.mainnetExecutor;
      default: throw new Error(`UNSUPPORTED_NETWORK: ${network}`);
    }
  }

  async quoteBuy(params: QuoteParams) { return this.getExecutor(params.network || 'paper').quoteBuy(params); }
  async quoteSell(params: QuoteParams) { return this.getExecutor(params.network || 'paper').quoteSell(params); }
  async buy(params: ExecuteParams) {
    if (!params.network) throw new Error('NETWORK_REQUIRED: Execution network must be explicit');
    return this.getExecutor(params.network).buy(params);
  }
  async sell(params: ExecuteParams) {
    if (!params.network) throw new Error('NETWORK_REQUIRED: Execution network must be explicit');
    return this.getExecutor(params.network).sell(params);
  }
  async getBalance(walletAddress?: string) {
    const network = walletAddress?.includes(':') ? walletAddress.split(':')[0] : 'paper';
    return this.getExecutor(network).getBalance(walletAddress);
  }
  async getTokenBalance(mint: string, walletAddress?: string) {
    const network = walletAddress?.includes(':') ? walletAddress.split(':')[0] : 'paper';
    return this.getExecutor(network).getTokenBalance(mint, walletAddress);
  }
}

export const executionGateway = ExecutionGateway.getInstance();
