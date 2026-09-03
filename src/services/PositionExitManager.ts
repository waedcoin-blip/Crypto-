// src/services/PositionExitManager.ts
import { ITradeExecutor } from './ITradeExecutor';
import { executionEngine } from './ExecutionEngine';
import { 
  RiskManager, 
  riskManager, 
  ManagedPosition, 
  RiskConfig 
} from './RiskManager';

export type ManagedExitPosition = ManagedPosition;
export type DefaultExitConfig = RiskConfig;

export type ExitCallback = (mint: string, side: string, signature: string, pnlPct: number, outputAmountSol?: number) => void;
export type ExitErrorCallback = (mint: string, side: string, errorMessage: string) => void;
export type RiskLogCallback = (msg: string, type: string, category?: string, metadata?: any) => void;

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

  public addPosition(params: any): void {
    this.delegate.addPosition(params);
  }

  public onPriceUpdate(
    mint: string,
    currentPrice: number,
    _timestamp?: number,
    _quoteCurrency: 'SOL' | 'USD' = 'SOL',
    _source: 'jupiter' = 'jupiter'
  ): void {
    this.delegate.onPriceUpdate(mint, currentPrice);
  }

  public confirmBuy(
    mint: string,
    signature: string,
    _slot?: number,
    _actualAmountRaw?: number,
    _actualSolSpent?: number
  ): void {
    this.delegate.confirmBuy(mint, signature);
  }

  public requestExit(mint: string, reason?: string, _customAmountLamports?: number, _costBasisSol?: number): Promise<void> {
    return this.delegate.requestExit(mint, reason || 'MANUAL_EXIT');
  }

  public updatePositionTpSl(mint: string, tpPct?: number, slPct?: number, _trailingSlPct?: number): void {
    this.delegate.updatePositionTpSl(mint, tpPct ?? 25, slPct ?? 15);
  }

  public start(): void {
    this.delegate.start();
  }

  public stop(): void {
    this.delegate.stop();
  }

  public setOnExitCallback(_cb: ExitCallback): void {
    // No-op client-side
  }

  public setOnExitErrorCallback(_cb: ExitErrorCallback): void {
    // No-op client-side
  }

  public setOnLogCallback(_cb: RiskLogCallback): void {
    // No-op client-side
  }

  public getPosition(mint: string): ManagedPosition | undefined {
    return this.delegate.getPosition(mint);
  }

  public getPositions(): Map<string, ManagedPosition> {
    return this.delegate.getPositions();
  }
}

export const positionExitManager = new PositionExitManager();
