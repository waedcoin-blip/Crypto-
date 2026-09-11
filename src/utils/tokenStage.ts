// src/utils/tokenStage.ts
import { TokenStageInfo } from '../types/index.js';

export function detectTokenStage(token: any): TokenStageInfo {
  const bondingProgress = Number(token?.bondingCurveProgress || token?.bondingProgress || 0);
  const isMigrated = Boolean(token?.isMigrated || token?.isRaydiumListed || bondingProgress >= 100);
  const isBonding = !isMigrated && bondingProgress > 0 && bondingProgress < 100;
  const ageMinutes = Number(token?.ageMinutes || 0);
  const isNewListing = ageMinutes <= 15;
  const isNearMigration = isBonding && bondingProgress >= 85;

  return {
    isBonding,
    isMigrated,
    isNewListing,
    isNearMigration,
    stage: isMigrated ? 'MIGRATED' : isBonding ? 'BONDING' : 'UNKNOWN',
    platform: token?.platform || token?.dexId || 'pump.fun',
    bondingProgress,
  };
}
