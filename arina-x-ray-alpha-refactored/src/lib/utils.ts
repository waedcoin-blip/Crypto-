import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface TokenStageInfo {
  isBonding: boolean;       // still on Pump.fun bonding curve (0–99.4%)
  isMigrated: boolean;      // graduated to Raydium or PumpSwap
  isNewListing: boolean;    // very fresh, bonding < 10%
  isNearMigration: boolean; // close to graduating, bonding >= 80%
  stage: 'BONDING' | 'MIGRATED' | 'UNKNOWN';
  platform: 'PUMP_FUN' | 'RAYDIUM' | 'PUMPSWAP' | 'UNKNOWN';
  bondingProgress: number;
}

export function detectTokenStage(token: {
  address?: string;
  mintAddress?: string;
  dexId?: string;
  bondingCurveProgress?: number;
  isRaydiumListed?: boolean;
}): TokenStageInfo {
  const address = (token.address || token.mintAddress || '').toLowerCase();
  const dexId = (token.dexId || '').toLowerCase();
  const progress = token.bondingCurveProgress ?? 0;

  // ── SIGNAL 1: Mint address suffix ────────────────────────────────────────
  // Most Pump.fun bonding curve tokens have mint ending in 'pump'
  const hasPumpSuffix = address.endsWith('pump');

  // ── SIGNAL 2: DEX identifier ─────────────────────────────────────────────
  const isPumpFunDex   = dexId.includes('pump-fun') || dexId === 'pump_fun';
  const isPumpSwapDex  = dexId.includes('pumpswap');
  const isRaydiumDex   = dexId.includes('raydium');

  // ── SIGNAL 3: Bonding progress threshold ─────────────────────────────────
  // >= 99.5 means it has graduated or is in the process of migrating
  const progressSaysMigrated = progress >= 99.5;
  const progressSaysBonding  = progress > 0 && progress < 99.5;

  // ── DECISION ──────────────────────────────────────────────────────────────
  // Migrated = on Raydium/PumpSwap OR bonding complete OR no pump suffix (and not bonding)
  const isMigrated =
    isRaydiumDex ||
    isPumpSwapDex ||
    token.isRaydiumListed === true ||
    progressSaysMigrated ||
    (!hasPumpSuffix && !isPumpFunDex && !progressSaysBonding); // unknown/external token

  const isBonding = !isMigrated && (hasPumpSuffix || isPumpFunDex || progressSaysBonding);

  // Platform
  let platform: TokenStageInfo['platform'] = 'UNKNOWN';
  if (isPumpSwapDex)                        platform = 'PUMPSWAP';
  else if (isRaydiumDex)                    platform = 'RAYDIUM';
  else if (isBonding || isPumpFunDex)       platform = 'PUMP_FUN';

  return {
    isBonding,
    isMigrated,
    isNewListing:       isBonding && progress < 10,
    isNearMigration:    isBonding && progress >= 80,
    stage:    isBonding ? 'BONDING' : isMigrated ? 'MIGRATED' : 'UNKNOWN',
    platform,
    bondingProgress: progress,
  };
}
