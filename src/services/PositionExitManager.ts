// src/services/PositionExitManager.ts
import { ITradeExecutor } from './ITradeExecutor';
import { executionEngine } from './ExecutionEngine';
import { 
  RiskManager, 
  riskManager, 
  ManagedPosition, 
  RiskConfig, 
  ExitCallback, 
  ExitErrorCallback 
} from './RiskManager';

export type ManagedExitPosition = ManagedPosition;
export type DefaultExitConfig = RiskConfig;
export type { ExitCallback, ExitErrorCallback };

/**
 * PositionExitManager: Compatibility proxy delegating strictly to the singleton RiskManager.
 * Enforces a single global RiskManager instance across the entire application.
 */
export class PositionExitManager {
  private delegate: RiskManager = riskManager;

  constructor(
    _executor: ITradeExecutor = executionEngine,
    _jupiterRpcUrl: string = 'https://api.jup.ag/swap/v1',
    _dedicatedRpcUrl: string = '',
    _defaultConfig?: RiskConfig
  ) {
    // Delegate strictly to singleton riskManager instance
  }

  public setDedicatedRpc(_url: string): void {
    // No-op - dedicated RPC routing is managed in ExecutionEngine
  }

  public addPosition(params: Parameters<RiskManager['addPosition']>[0]): void {
    this.delegate.addPosition(params);
  }

  public onPriceUpdate(mint: string, currentPrice: number, timestamp?: number): void {
    this.delegate.onPriceUpdate(mint, currentPrice, timestamp);
  }

  public confirmBuy(
    mint: string,
    signature: string,
    slot?: number,
    actualAmountRaw?: number,
    actualSolSpent?: number
  ): void {
    this.delegate.confirmBuy(mint, signature, slot, actualAmountRaw, actualSolSpent);
  }

  public requestExit(mint: string, reason?: string, customAmountLamports?: number, costBasisSol?: number): Promise<void> {
    return this.delegate.requestExit(mint, reason, customAmountLamports, costBasisSol);
  }

  public updatePositionTpSl(mint: string, tpPct?: number, slPct?: number, trailingSlPct?: number): void {
    this.delegate.updatePositionTpSl(mint, tpPct, slPct, trailingSlPct);
  }

  public start(): void {
    this.delegate.start();
  }

  public stop(): void {
    this.delegate.stop();
  }

  public setOnExitCallback(cb: ExitCallback): void {
    this.delegate.setOnExitCallback(cb);
  }

  public setOnExitErrorCallback(cb: ExitErrorCallback): void {
    this.delegate.setOnExitErrorCallback(cb);
  }

  public getPosition(mint: string): ManagedPosition | undefined {
    return this.delegate.getPosition(mint);
  }

  public getPositions(): Map<string, ManagedPosition> {
    return this.delegate.getPositions();
  }
}

export const positionExitManager = riskManager;
