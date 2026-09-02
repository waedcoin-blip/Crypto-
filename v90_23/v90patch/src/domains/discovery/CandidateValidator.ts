import { TokenRecord } from '../../services/TokenRegistry';

export interface ValidationCriteria {
  minMcap?: number;
  maxMcap?: number;
  minLiquidity?: number;
  minAgeSec?: number;
  maxAgeSec?: number;
}

export class CandidateValidator {
  public static validateCandidate(token: Partial<TokenRecord>, criteria: ValidationCriteria = {}): { valid: boolean; reason?: string } {
    if (!token.mintAddress) {
      return { valid: false, reason: 'MISSING_MINT' };
    }

    if (criteria.minMcap && (token.marketCap || 0) < criteria.minMcap) {
      return { valid: false, reason: `MCAP_TOO_LOW: ${token.marketCap} < ${criteria.minMcap}` };
    }

    if (criteria.maxMcap && (token.marketCap || 0) > criteria.maxMcap) {
      return { valid: false, reason: `MCAP_TOO_HIGH: ${token.marketCap} > ${criteria.maxMcap}` };
    }

    if (criteria.minLiquidity && (token.liquidity || 0) < criteria.minLiquidity) {
      return { valid: false, reason: `LIQUIDITY_TOO_LOW: ${token.liquidity} < ${criteria.minLiquidity}` };
    }

    if (criteria.minAgeSec && token.discoveredAt) {
      const ageSec = (Date.now() - token.discoveredAt) / 1000;
      if (ageSec < criteria.minAgeSec) {
        return { valid: false, reason: `AGE_TOO_YOUNG: ${ageSec}s < ${criteria.minAgeSec}s` };
      }
    }

    return { valid: true };
  }
}
