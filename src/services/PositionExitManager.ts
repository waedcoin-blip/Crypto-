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
 * PositionExitManager: Compatibility adapter redirecting to RiskManager.
 */
export class PositionExitManager extends RiskManager {
  constructor(
    executor: ITradeExecutor = executionEngine,
    _jupiterRpcUrl: string = 'https://api.jup.ag/swap/v1',
    _dedicatedRpcUrl: string = '',
    defaultConfig: RiskConfig = { tpPct: 25, slPct: 15, slippageBpsTp: 250, slippageBpsSl: 1000 }
  ) {
    super(executor, defaultConfig);
  }

  public setDedicatedRpc(_url: string): void {
    // No-op - dedicated RPC routing is managed in ExecutionEngine
  }
}

export const positionExitManager = riskManager;
