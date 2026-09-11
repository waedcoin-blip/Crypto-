// shared/riskAnalyzerEngine.ts (Adjust path as needed)
import { TokenMetric } from '../types';
import { useAppStore } from '../store/appStore';
import { eventBus } from './eventBus';

export interface RiskState {
  tokenAddress: string;
  riskScore?: number;
  liquidityRatio?: number;
  devOwnership?: number;
  warnings: string[];
}

export class RiskAnalyzerEngine {
  private riskStates: Map<string, RiskState> = new Map();

  public analyzeToken(token: Partial<TokenMetric> & { address: string }): RiskState {
    const appState = useAppStore.getState();
    const criteria = appState.criteria || {};
    const hardenedMaxRiskScore = criteria.hardenedMaxRiskScore ?? Number(localStorage.getItem('hd_max_risk_score')) ?? 18;
    const hardenedLiquidityRatio = criteria.hardenedLiquidityRatio ?? Number(localStorage.getItem('hd_liquidity_ratio')) ?? 10;
    const hardenedMaxDevOwnership = criteria.hardenedMaxDevOwnership ?? Number(localStorage.getItem('hd_max_dev_ownership')) ?? 10;

    const state: RiskState = {
      tokenAddress: token.address,
      riskScore: token.riskScore,
      warnings: []
    };

    if (token.riskScore !== undefined && token.riskScore > hardenedMaxRiskScore) {
       state.warnings.push(`High Risk Score: ${token.riskScore}`);
       eventBus.emit('RUG_RISK_DETECTED', { tokenAddress: token.address, riskScore: token.riskScore });
    }

    if (token.liquidity && token.marketCap) {
        const ratio = (token.liquidity / token.marketCap) * 100;
        state.liquidityRatio = ratio;
        if (ratio < hardenedLiquidityRatio) {
            state.warnings.push(`Low Liquidity Ratio: ${ratio.toFixed(2)}%`);
            eventBus.emit('LIQUIDITY_WARNING', { tokenAddress: token.address, ratio });
        }
    }

    // FIX: Actually use hardenedMaxDevOwnership to check for centralized risk
    if (token.devOwnership !== undefined && token.devOwnership > hardenedMaxDevOwnership) {
        state.devOwnership = token.devOwnership;
        state.warnings.push(`High Dev Ownership: ${token.devOwnership}%`);
    }

    this.riskStates.set(token.address, state);
    return state;
  }

  public getRiskState(tokenAddress: string): RiskState | undefined {
    return this.riskStates.get(tokenAddress);
  }

  public getAllRiskStates(): RiskState[] {
    return Array.from(this.riskStates.values());
  }
}

export const riskAnalyzer = new RiskAnalyzerEngine();