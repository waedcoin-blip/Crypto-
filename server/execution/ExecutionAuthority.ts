// server/execution/ExecutionAuthority.ts
import { tradingSupervisor } from '../trading/TradingSupervisor.js';

export interface AuthoritativeTradingState {
  network: 'paper' | 'devnet' | 'mainnet';
  mode: 'paper' | 'live';
  isLiveTrading: boolean;
  supervisorState: 'TRADING' | 'STOPPED' | 'STARTING' | 'RECOVERY' | string;
  executionAuthority: 'PAPER' | 'LIVE';
}

export class ExecutionAuthority {
  private static instance: ExecutionAuthority;

  private constructor() {}

  public static getInstance(): ExecutionAuthority {
    if (!ExecutionAuthority.instance) {
      ExecutionAuthority.instance = new ExecutionAuthority();
    }
    return ExecutionAuthority.instance;
  }

  /**
   * Returns the authoritative execution state derived solely from TradingSupervisor.
   */
  public static getAuthoritativeState(): AuthoritativeTradingState {
    const status = tradingSupervisor.getStatus();
    const network = (status.network || 'paper').toLowerCase().trim() as 'paper' | 'devnet' | 'mainnet';
    const isLive = network !== 'paper';

    return {
      network,
      mode: isLive ? 'live' : 'paper',
      isLiveTrading: isLive,
      supervisorState: status.state,
      executionAuthority: isLive ? 'LIVE' : 'PAPER',
    };
  }

  /**
   * Enforces an unbypassable execution guard before any live on-chain or network transaction.
   * Throws LIVE_EXECUTION_BLOCKED_IN_PAPER_MODE if TradingSupervisor is in paper mode,
   * or LIVE_EXECUTION_BLOCKED_NOT_IN_TRADING_STATE if supervisor is not in active TRADING state.
   */
  public static assertLiveExecutionAllowed(targetNetwork: string): void {
    const state = ExecutionAuthority.getAuthoritativeState();
    const normalizedTarget = (targetNetwork || '').toLowerCase().trim();

    // Invariant 1: If TradingSupervisor is in paper mode or isLiveTrading is false
    if (state.network === 'paper' || !state.isLiveTrading || state.executionAuthority !== 'LIVE') {
      throw new Error(
        `LIVE_EXECUTION_BLOCKED_IN_PAPER_MODE: TradingSupervisor is in network='${state.network}', mode='${state.mode}', isLiveTrading=${state.isLiveTrading}. Live blockchain execution is strictly forbidden.`
      );
    }

    // Invariant 2: Live execution is strictly permitted only when network is mainnet or devnet, isLiveTrading is true, and state is TRADING
    if (!['mainnet', 'mainnet-beta', 'devnet'].includes(normalizedTarget)) {
      throw new Error(
        `LIVE_EXECUTION_BLOCKED_IN_PAPER_MODE: Target network '${targetNetwork}' is not a valid live network.`
      );
    }

    if (state.supervisorState !== 'TRADING') {
      throw new Error(
        `LIVE_EXECUTION_BLOCKED_NOT_IN_TRADING_STATE: TradingSupervisor lifecycle state is '${state.supervisorState}'. Live execution strictly requires active 'TRADING' state.`
      );
    }
  }
}

export const executionAuthority = ExecutionAuthority.getInstance();
