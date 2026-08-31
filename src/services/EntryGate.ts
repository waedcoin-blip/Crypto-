// src/services/EntryGate.ts
import { useAppStore } from '../store/appStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { riskManager } from './RiskManager';
import { getTradingBalance } from '../store/balanceStore';

export interface EntryValidationResult {
  allowed: boolean;
  reason: string;
  buyAmountSol?: number;
}

export interface CandidateTokenData {
  address: string;
  symbol: string;
  pairCreatedAt?: number; // timestamp in ms
  liquidityUsd?: number;
  devWalletOwnershipPct?: number;
  top10HoldersPct?: number;
  riskScore?: number;
  isSellable?: boolean;
  isVerified?: boolean;
  mintAuthorityRevoked?: boolean;
  freezeAuthorityRevoked?: boolean;
  metadataImmutable?: boolean;
  dexId?: string;
  hasUnknownDecimals?: boolean;
}

export class EntryGate {
  private static instance: EntryGate;
  private pendingEntries: Set<string> = new Set();

  public static getInstance(): EntryGate {
    if (!EntryGate.instance) {
      EntryGate.instance = new EntryGate();
    }
    return EntryGate.instance;
  }

  /**
   * Authoritative fail-closed entry validation rule.
   * Every entry path (telemetry, scanner, PnLPage, App auto-trade) MUST route through this method.
   */
  public validateEntry(candidate: CandidateTokenData): EntryValidationResult {
    const mint = candidate.address;
    if (!mint || mint === 'So11111111111111111111111111111111111111112') {
      return { allowed: false, reason: 'INVALID_MINT' };
    }

    const appState = useAppStore.getState();
    if (!appState.autoSniperEnabled) {
      return { allowed: false, reason: 'AUTO_SNIPER_DISABLED' };
    }

    // Pending/Active position guard
    if (this.pendingEntries.has(mint)) {
      return { allowed: false, reason: 'ENTRY_ALREADY_PENDING' };
    }

    const existingPosition = riskManager.getPosition(mint);
    if (existingPosition && (existingPosition.state === 'OPEN' || existingPosition.state === 'PENDING_BUY' || existingPosition.state === 'CLOSING')) {
      return { allowed: false, reason: 'POSITION_ALREADY_EXISTS' };
    }

    // Trade limit check (max 1 trade per token)
    const hasTradedBefore = appState.mySniperTrades.some(t => t.address === mint);
    if (hasTradedBefore) {
      return { allowed: false, reason: 'MAX_1_TRADE_PER_TOKEN_EXCEEDED' };
    }

    // Max open positions check
    if (!riskManager.canOpenNewPosition()) {
      return { allowed: false, reason: 'MAX_POSITIONS_REACHED' };
    }

    // Fail closed: Unknown decimals
    if (candidate.hasUnknownDecimals) {
      return { allowed: false, reason: 'UNKNOWN_DECIMALS_FAIL_CLOSED' };
    }

    // Retrieve criteria thresholds from server repository or criteria config
    let criteria = {
      minLiquidityUsd: 5000,
      minAgeMinutes: 0,
      maxAgeMinutes: 1440,
      maxDevOwnershipPct: 10,
      maxTop10Pct: 40,
      maxRiskScore: 22,
    };

    if (typeof window === 'undefined') {
      try {
        const { criteriaRepository } = require('../../server/repositories/CriteriaRepository.js');
        criteria = criteriaRepository.getActiveCriteriaSync();
      } catch (e) {
        // Fallback
      }
    }

    const minLiquidity = criteria.minLiquidityUsd;
    const minAgeMinutes = criteria.minAgeMinutes;
    const maxAgeMinutes = criteria.maxAgeMinutes;
    const maxDevPct = criteria.maxDevOwnershipPct ?? appState.hardenedMaxDevOwnership ?? 10;
    const maxTop10Pct = criteria.maxTop10Pct;
    const maxRiskScore = criteria.maxRiskScore ?? appState.hardenedMaxRiskScore ?? 22;

    const now = Date.now();

    // Age validation (Fail closed if age required but unknown)
    if (candidate.pairCreatedAt !== undefined && candidate.pairCreatedAt > 0) {
      const ageMinutes = (now - candidate.pairCreatedAt) / 60000;
      if (minAgeMinutes > 0 && ageMinutes < minAgeMinutes) {
        return { allowed: false, reason: 'TOKEN_TOO_YOUNG' };
      }
      if (maxAgeMinutes > 0 && ageMinutes > maxAgeMinutes) {
        return { allowed: false, reason: 'TOKEN_TOO_OLD' };
      }
    } else if (minAgeMinutes > 0 || maxAgeMinutes < 1440) {
      return { allowed: false, reason: 'UNKNOWN_TOKEN_AGE_FAIL_CLOSED' };
    }

    // Liquidity validation
    if (candidate.liquidityUsd !== undefined) {
      if (candidate.liquidityUsd < minLiquidity) {
        return { allowed: false, reason: `LIQUIDITY_TOO_LOW: $${candidate.liquidityUsd.toFixed(0)} < $${minLiquidity}` };
      }
    } else if (minLiquidity > 0) {
      return { allowed: false, reason: 'UNKNOWN_LIQUIDITY_FAIL_CLOSED' };
    }

    // Dev Ownership validation
    if (candidate.devWalletOwnershipPct !== undefined) {
      if (candidate.devWalletOwnershipPct > maxDevPct) {
        return { allowed: false, reason: `DEV_OWNERSHIP_TOO_HIGH: ${candidate.devWalletOwnershipPct.toFixed(1)}% > ${maxDevPct}%` };
      }
    } else if (maxDevPct < 100) {
      return { allowed: false, reason: 'UNKNOWN_DEV_OWNERSHIP_FAIL_CLOSED' };
    }

    // Top 10 Ownership validation
    if (candidate.top10HoldersPct !== undefined) {
      if (candidate.top10HoldersPct > maxTop10Pct) {
        return { allowed: false, reason: `TOP10_OWNERSHIP_TOO_HIGH: ${candidate.top10HoldersPct.toFixed(1)}% > ${maxTop10Pct}%` };
      }
    } else if (maxTop10Pct < 100) {
      return { allowed: false, reason: 'UNKNOWN_TOP10_OWNERSHIP_FAIL_CLOSED' };
    }

    // Risk score validation
    if (candidate.riskScore !== undefined) {
      if (candidate.riskScore > maxRiskScore) {
        return { allowed: false, reason: `RISK_SCORE_EXCEEDED: ${candidate.riskScore} > ${maxRiskScore}` };
      }
    } else if (maxRiskScore < 100) {
      return { allowed: false, reason: 'UNKNOWN_RISK_SCORE_FAIL_CLOSED' };
    }

    // Sellability check (Fail closed if explicitly false)
    if (candidate.isSellable === false) {
      return { allowed: false, reason: 'NOT_SELLABLE' };
    }

    // Balance check
    const buyAmountSol = appState.buyAmountSol || 0.1;
    const isLive = useTradingEnvironmentStore.getState().network === 'mainnet';
    if (!isLive) {
      try {
        const paperBal = getTradingBalance('paper');
        if (paperBal < buyAmountSol) {
          return { allowed: false, reason: 'INSUFFICIENT_PAPER_BALANCE' };
        }
      } catch {
        // Balance unavailable
      }
    }

    return { allowed: true, reason: 'OK', buyAmountSol };
  }

  public markEntryPending(mint: string) {
    this.pendingEntries.add(mint);
  }

  public clearEntryPending(mint: string) {
    this.pendingEntries.delete(mint);
  }
}

export const entryGate = EntryGate.getInstance();
